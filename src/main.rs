//! logswarm — Summon a swarm of programs to do your computations and daemon the
//! full power of the localhost into your service.

use std::path::PathBuf;
use std::process;

use logswarm::config::Config;

fn main() {
    let args: Vec<String> = std::env::args().collect();

    let mut config_path = PathBuf::from("configs/default.toml");
    let mut assets_dir: Option<PathBuf> = None;
    let mut workers_override: Option<usize> = None;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--config" => {
                i += 1;
                if i >= args.len() {
                    eprintln!("Error: --config requires a path argument");
                    process::exit(1);
                }
                config_path = PathBuf::from(&args[i]);
            }
            "--assets-dir" => {
                i += 1;
                if i >= args.len() {
                    eprintln!("Error: --assets-dir requires a path argument");
                    process::exit(1);
                }
                assets_dir = Some(PathBuf::from(&args[i]));
            }
            "--workers" => {
                i += 1;
                if i >= args.len() {
                    eprintln!("Error: --workers requires a positive integer");
                    process::exit(1);
                }
                workers_override = Some(args[i].parse().unwrap_or_else(|_| {
                    eprintln!("Error: --workers requires a positive integer");
                    process::exit(1);
                }));
            }
            other => {
                eprintln!("Unknown argument: {other}");
                process::exit(1);
            }
        }
        i += 1;
    }

    let mut config = Config::load(&config_path).unwrap_or_else(|e| {
        eprintln!("Error loading config from {}: {e}", config_path.display());
        process::exit(1);
    });

    if let Some(w) = workers_override {
        config.swarm.workers = w;
    }

    if let Some(dir) = assets_dir {
        config.assets.dir = dir;
    }

    let num_workers = if config.swarm.workers == 0 {
        std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1)
    } else {
        config.swarm.workers
    };

    println!(
        "logswarm: config={} workers={} queue={} log_level={}",
        config_path.display(),
        num_workers,
        config.swarm.max_queue_size,
        config.logging.level,
    );
    println!(
        "logswarm: assets_dir={} templates_dir={}",
        config.assets.dir.display(),
        config.assets.templates_dir.display(),
    );
    println!("logswarm: swarm ready — {num_workers} worker(s) standing by");
}
