# Assets

This directory contains shared resources that are available to **every**
component of the logswarm project (coordinator, workers, scripts, and tests).

## Directory Layout

```
assets/
├── README.md            # This file
└── templates/           # Shared templates (task definitions, reports, …)
```

## Guidelines

| Rule | Description |
|------|-------------|
| **Single source** | Never duplicate an asset — reference this directory instead. |
| **Read-only at runtime** | Assets must be treated as immutable during execution. |
| **Relative paths** | Always resolve paths relative to the project root or the `[assets]` section in the configuration file. |
| **Version-controlled** | Every asset must be committed to the repository. Generated or binary artefacts belong in `.gitignore`. |

See [docs/USAGE.md](../docs/USAGE.md) for full usage instructions and
[docs/DESIGN.md](../docs/DESIGN.md) for design guidelines.
