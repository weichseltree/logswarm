# logswarm

A virtual swarm of service agents that process heterogeneous data streams in real time, with a browser-based dashboard that renders stream data as an interactive navigation map powered by a graph neural network.

## Quick Start

```bash
# Build the daemon
cargo build --release

# Install and register the service
sudo ./install.sh

# Open the dashboard
xdg-open http://127.0.0.1:8420
```

## Architecture

See the [Architecture Guide](docs/architecture/README.md) for a full overview. Key documents:

| Document | Scope |
|----------|-------|
| [Service Registration](docs/architecture/01-service-registration.md) | Install script, systemd unit, configuration |
| [Frontend Dashboard](docs/architecture/02-frontend-dashboard.md) | Canvas rendering, permissions, UI overlays |
| [Input Streams](docs/architecture/03-input-streams.md) | Space-like vs time-like streams, now-bins |
| [Graph Neural Network](docs/architecture/04-graph-neural-network.md) | GNN engine, neural compression, canvas ownership |
| [Virtual Agents](docs/architecture/05-virtual-agents.md) | Agent lifecycle, heartbeat polling, URL routing |
| [Backend Integration](docs/architecture/06-backend-integration.md) | SpacetimeDB, Firebase, adapter interface |
| [Authentication](docs/architecture/07-authentication.md) | Local device auth, 2FA, trusted device pairing |

## License

MIT
