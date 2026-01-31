# A9 Forge CI (GitHub Action)

A GitHub Action that installs the Atlassian Forge CLI, then runs `forge deploy` and optionally `forge install` in a non-interactive CI-friendly way.

This action is designed to be publishable to GitHub Marketplace:
- A single `action.yml` at the repository root
- No workflow files checked into the action repository (use a separate repo to test it)

## Why this exists

Atlassian documents how to automate Forge deploy and install in CI using the Forge CLI and the `FORGE_EMAIL` and `FORGE_API_TOKEN` environment variables. The CLI supports non-interactive `deploy` and `install` commands, so they can run in headless CI.

## Inputs

See `action.yml` for the full list. Common ones:
- `working-directory` (default: `.`)
- `forge-cli-version` (default: `latest`)
- `environment` (default: `staging`)
- `deploy` (default: `true`)
- `install` (default: `false`)
- `site` and `product` are required when `install=true`

## Required secrets

Create these as GitHub Actions secrets in the repository that uses the action:
- `FORGE_EMAIL`
- `FORGE_API_TOKEN`

## Example workflow (in your Forge app repo)

Create a workflow in your Forge app repository (not in this action repository):

```yaml
name: Deploy Forge app
on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Deploy to staging (and upgrade installation)
        uses: your-org/a9-forge-ci@v1
        env:
          FORGE_EMAIL: ${{ secrets.FORGE_EMAIL }}
          FORGE_API_TOKEN: ${{ secrets.FORGE_API_TOKEN }}
        with:
          working-directory: "."
          environment: "staging"
          pre-run: |
            npm ci
          deploy: "true"
          install: "true"
          site: "example.atlassian.net"
          product: "jira"
          upgrade: "true"
          confirm-scopes: "true"
```

## Notes

- If your Forge app uses a Node runtime with specific requirements, use `actions/setup-node` accordingly.
- For production deployments, you may prefer to `deploy` but not auto-`install` so major version approvals can be handled via UPM.
