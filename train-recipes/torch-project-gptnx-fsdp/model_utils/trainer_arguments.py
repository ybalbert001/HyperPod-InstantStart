import argparse
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ModelTrainingArguments:
    """Arguments for model and training configuration."""
    
    # Model arguments
    model_type: str = field(default="gpt_neox", metadata={"help": "Model type"})
    max_context_width: int = field(default=2048, metadata={"help": "Maximum context width"})
    vocab_size: int = field(default=50432, metadata={"help": "Vocabulary size"})
    hidden_width: int = field(default=768, metadata={"help": "Hidden dimension"})
    num_layers: int = field(default=12, metadata={"help": "Number of layers"})
    num_heads: int = field(default=12, metadata={"help": "Number of attention heads"})
    intermediate_size: int = field(default=11008, metadata={"help": "Intermediate size for MLP"})
    num_key_value_heads: Optional[int] = field(default=None, metadata={"help": "Number of key-value heads for GQA"})
    resid_pdrop: float = field(default=0.1, metadata={"help": "Residual dropout"})
    embd_pdrop: float = field(default=0.1, metadata={"help": "Embedding dropout"})
    attn_pdrop: float = field(default=0.1, metadata={"help": "Attention dropout"})
    summary_first_pdrop: float = field(default=0.1, metadata={"help": "Summary first dropout"})
    initializer_range: float = field(default=0.02, metadata={"help": "Initializer range"})
    rotary_pct: float = field(default=0.25, metadata={"help": "Rotary position embedding percentage"})
    rotary_emb_base: int = field(default=10000, metadata={"help": "Rotary embedding base"})
    
    # Training arguments
    output_dir: str = field(default="./output", metadata={"help": "Output directory"})
    num_train_epochs: int = field(default=3, metadata={"help": "Number of training epochs"})
    max_steps: int = field(default=5000, metadata={"help": "Maximum training steps"})
    per_device_train_batch_size: int = field(default=2, metadata={"help": "Training batch size per device"})
    per_device_eval_batch_size: int = field(default=4, metadata={"help": "Evaluation batch size per device"})
    gradient_accumulation_steps: int = field(default=1, metadata={"help": "Gradient accumulation steps"})
    learning_rate: float = field(default=1e-4, metadata={"help": "Learning rate"})
    weight_decay: float = field(default=0.2, metadata={"help": "Weight decay"})
    adam_beta1: float = field(default=0.9, metadata={"help": "Adam beta1"})
    adam_beta2: float = field(default=0.95, metadata={"help": "Adam beta2"})
    max_grad_norm: float = field(default=1.0, metadata={"help": "Max gradient norm"})
    warmup_ratio: float = field(default=0.0032, metadata={"help": "Warmup ratio"})
    lr_scheduler_type: str = field(default="cosine", metadata={"help": "Learning rate scheduler type"})
    
    # Logging and saving
    logging_steps: int = field(default=1, metadata={"help": "Logging frequency"})
    save_steps: int = field(default=1000, metadata={"help": "Save frequency"})
    eval_steps: Optional[int] = field(default=None, metadata={"help": "Evaluation frequency"})
    save_total_limit: int = field(default=3, metadata={"help": "Total save limit"})
    
    # MLflow arguments
    report_to: Optional[str] = field(default=None, metadata={"help": "Experiment tracking service (mlflow, tensorboard, wandb, all)"})
    run_name: Optional[str] = field(default=None, metadata={"help": "Run name for experiment tracking"})
    
    # Data arguments
    dataset_name: str = field(default="wikitext", metadata={"help": "Dataset name"})
    dataset_config_name: str = field(default="wikitext-2-raw-v1", metadata={"help": "Dataset config name"})
    tokenizer_name: str = field(default="EleutherAI/gpt-neox-20b", metadata={"help": "Tokenizer name"})
    max_train_samples: Optional[int] = field(default=None, metadata={"help": "Maximum number of training samples"})
    max_eval_samples: Optional[int] = field(default=None, metadata={"help": "Maximum number of evaluation samples"})
    
    # FSDP arguments
    sharding_strategy: str = field(default="full", metadata={"help": "FSDP sharding strategy (full, hybrid)"})
    cpu_offload: bool = field(default=False, metadata={"help": "Enable CPU offloading"})
    limit_all_gathers: bool = field(default=True, metadata={"help": "Limit all gathers"})
    activation_checkpointing: bool = field(default=True, metadata={"help": "Enable activation checkpointing"})
    offload_activations: bool = field(default=False, metadata={"help": "Offload activations"})
    
    # Mixed precision
    bf16: bool = field(default=True, metadata={"help": "Use bfloat16"})
    
    # Checkpoint
    resume_from_checkpoint: Optional[str] = field(default=None, metadata={"help": "Resume from checkpoint path"})


def parse_trainer_args():
    """Parse command line arguments for trainer-based training."""
    parser = argparse.ArgumentParser(description="GPT Training with Transformers Trainer")
    
    # Model arguments
    model_group = parser.add_argument_group("Model Configuration")
    model_group.add_argument("--model_type", type=str, default="gpt_neox", help="Model type")
    model_group.add_argument("--max_context_width", type=int, default=2048, help="Maximum context width")
    model_group.add_argument("--vocab_size", type=int, default=50432, help="Vocabulary size")
    model_group.add_argument("--hidden_width", type=int, default=768, help="Hidden dimension")
    model_group.add_argument("--num_layers", type=int, default=12, help="Number of layers")
    model_group.add_argument("--num_heads", type=int, default=12, help="Number of attention heads")
    model_group.add_argument("--intermediate_size", type=int, default=11008, help="Intermediate size for MLP")
    model_group.add_argument("--num_key_value_heads", type=int, default=None, help="Number of key-value heads for GQA")
    model_group.add_argument("--resid_pdrop", type=float, default=0.1, help="Residual dropout")
    model_group.add_argument("--embd_pdrop", type=float, default=0.1, help="Embedding dropout")
    model_group.add_argument("--attn_pdrop", type=float, default=0.1, help="Attention dropout")
    model_group.add_argument("--summary_first_pdrop", type=float, default=0.1, help="Summary first dropout")
    model_group.add_argument("--initializer_range", type=float, default=0.02, help="Initializer range")
    model_group.add_argument("--rotary_pct", type=float, default=0.25, help="Rotary position embedding percentage")
    model_group.add_argument("--rotary_emb_base", type=int, default=10000, help="Rotary embedding base")
    
    # Training arguments
    train_group = parser.add_argument_group("Training Configuration")
    train_group.add_argument("--output_dir", type=str, default="./output", help="Output directory")
    train_group.add_argument("--num_train_epochs", type=int, default=3, help="Number of training epochs")
    train_group.add_argument("--max_steps", type=int, default=5000, help="Maximum training steps")
    train_group.add_argument("--per_device_train_batch_size", type=int, default=2, help="Training batch size per device")
    train_group.add_argument("--per_device_eval_batch_size", type=int, default=4, help="Evaluation batch size per device")
    train_group.add_argument("--gradient_accumulation_steps", type=int, default=1, help="Gradient accumulation steps")
    train_group.add_argument("--learning_rate", type=float, default=1e-4, help="Learning rate")
    train_group.add_argument("--weight_decay", type=float, default=0.2, help="Weight decay")
    train_group.add_argument("--adam_beta1", type=float, default=0.9, help="Adam beta1")
    train_group.add_argument("--adam_beta2", type=float, default=0.95, help="Adam beta2")
    train_group.add_argument("--max_grad_norm", type=float, default=1.0, help="Max gradient norm")
    train_group.add_argument("--warmup_ratio", type=float, default=0.0032, help="Warmup ratio")
    train_group.add_argument("--lr_scheduler_type", type=str, default="cosine", help="Learning rate scheduler type")
    
    # Logging and saving
    log_group = parser.add_argument_group("Logging and Saving")
    log_group.add_argument("--logging_steps", type=int, default=1, help="Logging frequency")
    log_group.add_argument("--save_steps", type=int, default=1000, help="Save frequency")
    log_group.add_argument("--eval_steps", type=int, default=None, help="Evaluation frequency")
    log_group.add_argument("--save_total_limit", type=int, default=3, help="Total save limit")
    
    # MLflow arguments
    mlflow_group = parser.add_argument_group("MLflow Configuration")
    mlflow_group.add_argument("--report_to", type=str, default=None, 
                             choices=["mlflow", "tensorboard", "wandb", "all"],
                             help="Experiment tracking service")
    mlflow_group.add_argument("--run_name", type=str, default=None, help="Run name for experiment tracking")
    
    # Data arguments
    data_group = parser.add_argument_group("Data Configuration")
    data_group.add_argument("--dataset_name", type=str, default="wikitext", help="Dataset name")
    data_group.add_argument("--dataset_config_name", type=str, default="wikitext-2-raw-v1", help="Dataset config name")
    data_group.add_argument("--tokenizer_name", type=str, default="EleutherAI/gpt-neox-20b", help="Tokenizer name")
    data_group.add_argument("--max_train_samples", type=int, default=None, help="Maximum number of training samples")
    data_group.add_argument("--max_eval_samples", type=int, default=None, help="Maximum number of evaluation samples")
    
    # FSDP arguments
    fsdp_group = parser.add_argument_group("FSDP Configuration")
    fsdp_group.add_argument("--sharding_strategy", type=str, default="full", 
                           choices=["full", "hybrid"], help="FSDP sharding strategy")
    fsdp_group.add_argument("--cpu_offload", action="store_true", help="Enable CPU offloading")
    fsdp_group.add_argument("--limit_all_gathers", action="store_true", default=True, help="Limit all gathers")
    fsdp_group.add_argument("--activation_checkpointing", action="store_true", default=True, help="Enable activation checkpointing")
    fsdp_group.add_argument("--offload_activations", action="store_true", help="Offload activations")
    
    # Mixed precision
    precision_group = parser.add_argument_group("Mixed Precision")
    precision_group.add_argument("--bf16", action="store_true", default=True, help="Use bfloat16")
    
    # Checkpoint
    checkpoint_group = parser.add_argument_group("Checkpoint")
    checkpoint_group.add_argument("--resume_from_checkpoint", type=str, default=None, help="Resume from checkpoint path")
    
    args = parser.parse_args()
    return args
