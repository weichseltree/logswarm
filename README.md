# logswarm

Run `logswarm.sh` to summon a swarm of programs to do your computations and daemon the full power of the localhost into your service.
A virtual swarm of service agents that process heterogeneous data streams in real time, with a browser-based dashboard that renders stream data as an interactive navigation map powered by a graph neural network.

## Quick Start

```bash
chmod +x logswarm.sh
./logswarm.sh
```

## Project Structure

```
logswarm/
├── logswarm.sh          # Shell entry point — builds & launches the swarm
├── Cargo.toml           # Rust package manifest
├── assets/              # Shared read-only resources for all components
│   └── templates/       # Task & report templates
├── configs/             # Configuration files (TOML)
│   └── default.toml     # Default configuration
├── docs/                # Documentation
│   ├── DESIGN.md        # Architecture & strict design guidelines
│   └── USAGE.md         # How to use configs, assets, and the launcher
└── src/                 # Rust source code
    ├── config.rs        # Shared config types & loader
    ├── lib.rs           # Library root
    └── main.rs          # CLI entry point / coordinator
```

## Documentation

* **[docs/DESIGN.md](docs/DESIGN.md)** — Architecture overview and strict
  design guidelines that all contributors must follow.
* **[docs/USAGE.md](docs/USAGE.md)** — How to use the shared assets, configs,
  and the `logswarm.sh` launcher.

## License

[MIT](LICENSE)
