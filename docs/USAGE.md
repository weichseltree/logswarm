# logswarm Usage Guide

> How to use the shared assets, configs, and the `logswarm.sh` launcher.

---

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/weichseltree/logswarm.git
cd logswarm

# 2. Build and launch with defaults
chmod +x logswarm.sh
./logswarm.sh
```

The script will:

1. Locate `configs/default.toml` and the `assets/` directory.
2. Build the Rust binary if it is not already compiled.
3. Start the coordinator which spawns worker processes.

---

## Configuration

### Default Config

All settings live in **`configs/default.toml`**.  This file is the single
source of truth — every component reads from it.

| Section | Key | Default | Description |
|---------|-----|---------|-------------|
| `[swarm]` | `workers` | `0` (auto) | Worker count.  `0` = one per logical CPU. |
| `[swarm]` | `max_queue_size` | `1024` | Maximum queued tasks before back-pressure. |
| `[coordinator]` | `health_check_interval_ms` | `5000` | Health-check poll interval. |
| `[coordinator]` | `worker_timeout_ms` | `10000` | Timeout before a worker is marked unhealthy. |
| `[worker]` | `max_concurrent_tasks` | `4` | Concurrent tasks per worker. |
| `[worker]` | `work_dir` | `tmp/work` | Task working directory. |
| `[logging]` | `level` | `info` | Minimum log level (`trace` / `debug` / `info` / `warn` / `error`). |
| `[logging]` | `output` | `stdout` | Log destination (`stdout`, `stderr`, or a file path). |
| `[assets]` | `dir` | `assets` | Root asset directory. |
| `[assets]` | `templates_dir` | `assets/templates` | Template sub-directory. |

### Custom Config

Copy the default and override only what you need:

```bash
cp configs/default.toml configs/production.toml
# Edit configs/production.toml …
./logswarm.sh --config configs/production.toml
```

### CLI Overrides

CLI flags take precedence over the config file:

```bash
# Launch with 8 workers regardless of config
./logswarm.sh --workers 8

# Combine a custom config with a worker override
./logswarm.sh --config configs/production.toml --workers 16
```

---

## Assets

The **`assets/`** directory contains shared, read-only resources.  All parts
of the project — coordinator, workers, scripts, and tests — access them
through the paths declared in the `[assets]` section of the config.

### Adding a New Asset

1. Place the file under `assets/` (or a sub-directory such as
   `assets/templates/`).
2. Commit it to version control.
3. Reference it using the configured asset path.  In Rust code:

   ```rust
   use std::path::Path;

   let asset_root = Path::new(&config.assets.dir);
   let my_asset   = asset_root.join("templates/my_template.txt");
   ```

### Rules

* Assets are **read-only** at runtime.
* Paths are **relative** to the project root.
* **Never duplicate** an asset — keep a single copy in `assets/`.

---

## Programmatic Access (Rust)

Load the shared config in Rust code:

```rust
use std::path::Path;
use logswarm::config::Config;

let config = Config::load(Path::new("configs/default.toml"))
    .expect("failed to load config");

println!("Workers: {}", config.swarm.workers);
println!("Assets dir: {}", config.assets.dir.display());
```

The `Config` struct mirrors the TOML layout exactly, so every section and key
is directly accessible.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Error: Configuration file not found` | Run from the project root or pass `--config <path>`. |
| `Error: Assets directory not found` | Ensure `assets/` exists in the project root. |
| `Binary not found — building …` | First run; Cargo will compile the project. Requires a Rust toolchain. |

---

## Further Reading

* [docs/DESIGN.md](DESIGN.md) — architecture and strict design guidelines.
* [configs/README.md](../configs/README.md) — configuration directory overview.
* [assets/README.md](../assets/README.md) — asset directory overview.
