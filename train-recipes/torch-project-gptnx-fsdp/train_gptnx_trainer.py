import functools
import os
import torch
import torch.distributed as dist
from transformers import (
    AutoModelForCausalLM, 
    AutoTokenizer,
    TrainingArguments,
    Trainer,
    DataCollatorForLanguageModeling
)
from datasets import load_dataset
from torch.distributed.fsdp import FullyShardedDataParallel as FSDP
from torch.distributed.fsdp import MixedPrecision, ShardingStrategy, CPUOffload
from torch.distributed.fsdp.wrap import transformer_auto_wrap_policy

from model_utils.train_utils import (
    get_model_config, 
    compute_num_params,
    get_transformer_layer,
    get_logger
)
from model_utils.trainer_arguments import parse_trainer_args

logger = get_logger()


class FSDPTrainer(Trainer):
    """Custom Trainer with FSDP support."""
    
    def __init__(self, fsdp_config=None, **kwargs):
        self.fsdp_config = fsdp_config
        super().__init__(**kwargs)
    
    def create_optimizer_and_scheduler(self, num_training_steps: int):
        """Create optimizer and scheduler with FSDP-compatible parameter groups."""
        from model_utils.train_utils import get_param_groups_by_weight_decay
        
        if self.optimizer is None:
            param_groups = get_param_groups_by_weight_decay(self.model)
            self.optimizer = torch.optim.AdamW(
                param_groups,
                lr=self.args.learning_rate,
                betas=(self.args.adam_beta1, self.args.adam_beta2),
                weight_decay=self.args.weight_decay,
            )
        
        if self.lr_scheduler is None:
            self.lr_scheduler = self.create_scheduler(
                num_training_steps=num_training_steps,
                optimizer=self.optimizer
            )


def setup_fsdp_model(model, args):
    """Setup FSDP wrapping for the model."""
    transformer_layer = get_transformer_layer(args.model_type)
    
    auto_wrap_policy = functools.partial(
        transformer_auto_wrap_policy,
        transformer_layer_cls={transformer_layer},
    )
    
    if args.bf16:
        dtype = torch.bfloat16
    else:
        dtype = torch.float32
    
    mixed_precision_policy = MixedPrecision(
        param_dtype=dtype, 
        reduce_dtype=dtype, 
        buffer_dtype=dtype
    )
    
    if args.sharding_strategy == "full":
        sharding_strategy = ShardingStrategy.FULL_SHARD
    elif args.sharding_strategy == "hybrid":
        sharding_strategy = ShardingStrategy.HYBRID_SHARD
    else:
        raise NotImplementedError("Available sharding strategies are full and hybrid")
    
    cpu_offload = CPUOffload(offload_params=True) if args.cpu_offload else None
    
    global_rank = dist.get_rank() if dist.is_initialized() else 0
    device = global_rank % torch.cuda.device_count()
    
    model = FSDP(
        model,
        auto_wrap_policy=auto_wrap_policy,
        mixed_precision=mixed_precision_policy,
        limit_all_gathers=args.limit_all_gathers,
        device_id=torch.cuda.current_device(),
        use_orig_params=False,
        sharding_strategy=sharding_strategy,
        cpu_offload=cpu_offload,
        sync_module_states=True,
        param_init_fn=(lambda module: module.to_empty(device=torch.device("cuda"), recurse=False))
        if global_rank != 0 else None,
    )
    
    return model


def prepare_dataset(args, tokenizer):
    """Prepare the training and validation datasets using regular (non-streaming) loading."""
    
    # Load dataset - will download and cache locally
    print(f"Loading dataset: {args.dataset_name}")
    if args.dataset_config_name:
        dataset = load_dataset(args.dataset_name, args.dataset_config_name)
    else:
        dataset = load_dataset(args.dataset_name)
    
    print(f"Dataset loaded. Available splits: {list(dataset.keys())}")
    
    def tokenize_function(example):
        # Process single example at a time
        text = example["text"]
        
        # Handle empty or invalid texts
        if not text or not isinstance(text, str) or len(text.strip()) <= 10:
            text = "Hello world"  # Simple fallback text
            
        # Tokenize text with padding and truncation
        tokenized = tokenizer(
            text.strip(),
            truncation=True,
            padding="max_length",  # Pad to max_length
            max_length=args.max_context_width,
            return_tensors=None
        )
        
        # Simple return - all sequences will have same length
        return {
            "input_ids": tokenized["input_ids"],
            "attention_mask": tokenized["attention_mask"],
            "labels": tokenized["input_ids"].copy()  # Copy for labels
        }
    
    # Tokenize train dataset
    train_dataset = dataset["train"].map(
        tokenize_function,
        remove_columns=dataset["train"].column_names,
        desc="Tokenizing train dataset"
    )
    
    # Limit dataset size if specified
    if hasattr(args, 'max_train_samples') and args.max_train_samples:
        train_dataset = train_dataset.select(range(min(args.max_train_samples, len(train_dataset))))
    
    # Tokenize validation dataset if available
    eval_dataset = None
    if "validation" in dataset:
        eval_dataset = dataset["validation"].map(
            tokenize_function,
            remove_columns=dataset["validation"].column_names,
            desc="Tokenizing validation dataset"
        )
        
        # Limit eval dataset size
        if hasattr(args, 'max_eval_samples') and args.max_eval_samples:
            eval_dataset = eval_dataset.select(range(min(args.max_eval_samples, len(eval_dataset))))
    
    elif "test" in dataset:
        # Use test split as validation if no validation split
        eval_dataset = dataset["test"].map(
            tokenize_function,
            remove_columns=dataset["test"].column_names,
            desc="Tokenizing test dataset"
        )
        
        if hasattr(args, 'max_eval_samples') and args.max_eval_samples:
            eval_dataset = eval_dataset.select(range(min(args.max_eval_samples, len(eval_dataset))))
    
    print(f"Train dataset size: {len(train_dataset)}")
    if eval_dataset:
        print(f"Eval dataset size: {len(eval_dataset)}")
    
    return train_dataset, eval_dataset


def main():
    # Parse arguments
    args = parse_trainer_args()
    
    # Initialize distributed training
    if not dist.is_initialized():
        dist.init_process_group()
    
    global_rank = dist.get_rank()
    world_size = dist.get_world_size()
    device = global_rank % torch.cuda.device_count()
    torch.cuda.set_device(device)
    
    # Load tokenizer
    tokenizer = AutoTokenizer.from_pretrained(args.tokenizer_name, legacy=False)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    
    # Create model config and model
    model_config = get_model_config(args)
    
    if global_rank == 0:
        logger.info("Creating Model")
        model = AutoModelForCausalLM.from_config(model_config)
    else:
        with torch.device("meta"):
            model = AutoModelForCausalLM.from_config(model_config)
    
    num_params = compute_num_params(model)
    if global_rank == 0:
        logger.info(f"Created model with total parameters: {num_params} ({num_params * 1e-9:.2f}B)")
    
    # Setup FSDP
    model = setup_fsdp_model(model, args)
    
    # Apply activation checkpointing if enabled
    if args.activation_checkpointing:
        from model_utils.train_utils import apply_activation_checkpoint
        apply_activation_checkpoint(args, model=model)
    
    # Prepare datasets using regular loading
    train_dataset, eval_dataset = prepare_dataset(args, tokenizer)
    
    # No need for custom data collator since all sequences have same length
    from transformers import default_data_collator
    
    # Training arguments
    training_args = TrainingArguments(
        output_dir=args.output_dir,
        overwrite_output_dir=True,
        num_train_epochs=args.num_train_epochs,
        max_steps=args.max_steps,
        per_device_train_batch_size=args.per_device_train_batch_size,
        per_device_eval_batch_size=args.per_device_eval_batch_size,
        gradient_accumulation_steps=args.gradient_accumulation_steps,
        learning_rate=args.learning_rate,
        weight_decay=args.weight_decay,
        adam_beta1=args.adam_beta1,
        adam_beta2=args.adam_beta2,
        max_grad_norm=args.max_grad_norm,
        warmup_ratio=args.warmup_ratio,
        lr_scheduler_type=args.lr_scheduler_type,
        logging_steps=args.logging_steps,
        save_steps=args.save_steps,
        eval_steps=args.eval_steps if eval_dataset else None,
        save_strategy="steps",
        save_total_limit=args.save_total_limit,
        bf16=args.bf16,
        dataloader_drop_last=True,
        remove_unused_columns=False,  # Keep all columns as suggested by error message
        # MLflow configuration
        report_to=args.report_to,
        run_name=args.run_name,
        # Distributed training
        ddp_backend="nccl",
        ddp_find_unused_parameters=False,
    )
    
    # Create trainer
    trainer = FSDPTrainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        data_collator=default_data_collator,
        tokenizer=tokenizer,
    )
    
    # Start training
    if global_rank == 0:
        logger.info("Starting training...")
    
    # Resume from checkpoint if specified
    resume_from_checkpoint = args.resume_from_checkpoint
    
    trainer.train(resume_from_checkpoint=resume_from_checkpoint)
    
    # Save final model
    if global_rank == 0:
        trainer.save_model()
        logger.info("Training completed!")
    
    # Cleanup
    dist.destroy_process_group()


if __name__ == "__main__":
    main()
