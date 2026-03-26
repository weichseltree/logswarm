# Configs

This directory holds **all** configuration files for the logswarm project.
Every component — coordinator, workers, and the `logswarm.sh` launcher —
reads its settings from files in this directory.

## Files

| File | Purpose |
|------|---------|
| `default.toml` | Default configuration shipped with the project. |

## Overriding Defaults

Create a copy of `default.toml`, edit the values you need, and pass it to
the launcher:

```bash
cp configs/default.toml configs/my-env.toml
# edit configs/my-env.toml …
./logswarm.sh --config configs/my-env.toml
```

See [docs/USAGE.md](../docs/USAGE.md) for full documentation.
