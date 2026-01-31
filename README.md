# A9 Forge CI (GitHub Action)

Set up continuous delivery for Atlassian Forge apps using GitHub Actions.

This action installs the Forge CLI, authenticates using environment variables, then runs `forge deploy` and optionally `forge install` in a non-interactive way.

## On this page

- Before you begin
- Step 1: Create secrets and variables
- Step 2: Create a workflow from scratch
- Step 3: Configure continuous delivery to staging
- Step 4: Configure deployment to production
- Reference workflow
- Inputs and outputs
- Troubleshooting
- Security notes

## Before you begin

To complete this tutorial, you will need:

- A Forge app repository with `manifest.yml`
- A Forge app that has been created and installed to an Atlassian site at least once
- Admin rights on the target Atlassian site for installation and upgrade
- An Atlassian API token and the email address used for Forge
- Node.js available in the runner (GitHub hosted runners are fine)

You should also pin the Forge CLI major version in CI to reduce breaking changes. Example: set `forge-cli-version: "12"` to install the latest `12.x` release.

## Step 1: Create secrets and variables

Forge CLI authentication in CI uses these environment variables:

- `FORGE_EMAIL`
- `FORGE_API_TOKEN`

You can store them as repository secrets, environment secrets, or organization secrets.

### Recommended: GitHub Environments for staging and production

1. In your Forge app repository, go to Settings, then Environments.
2. Create two environments:
   - `staging`
   - `production`
3. For each environment, add secrets:
   - `FORGE_EMAIL`
   - `FORGE_API_TOKEN`
4. Optional environment variables (not secrets):
   - `ATLASSIAN_SITE` (example: `example.atlassian.net`)
   - `ATLASSIAN_PRODUCT` (`jira` or `confluence`)

Production tip: set environment protection rules on `production` (required reviewers, wait timers, or branch restrictions).

### Alternative: Repository secrets

If you only deploy to one target or you want the simplest setup:

1. Go to Settings, then Secrets and variables, then Actions.
2. Add repository secrets:
   - `FORGE_EMAIL`
   - `FORGE_API_TOKEN`

## Step 2: Create a workflow from scratch

Create a workflow file in your Forge app repository (not in the action repository):

`.github/workflows/forge-cd.yml`

Start with a lint job so problems show up early:

```yaml
name: Forge CD

on:
  push:
    branches: [ main ]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install deps and lint
        run: |
          npm ci
          npx @forge/cli@12 settings set usage-analytics true
          npx @forge/cli@12 lint
```

## Understanding usage analytics

Forge CLI may prompt for analytics consent in non-interactive environments. To keep CI repeatable, this action can set the Forge CLI preference automatically.

- Default behavior in this action: `usage-analytics: "true"`
- If you prefer not to enable analytics, set `usage-analytics: "false"` in the action inputs.

## Step 3: Configure continuous delivery to staging

Add a staging deployment job that runs after lint. This example deploys and then upgrades the installation on your staging site.

Important: This job uses `environment: staging`. That is how GitHub applies environment secrets and protection rules.

```yaml
  deploy_staging:
    runs-on: ubuntu-latest
    environment: staging
    needs: [ lint ]
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Deploy and upgrade install (staging)
        uses: your-org/a9-forge-ci@v1
        env:
          FORGE_EMAIL: ${{ secrets.FORGE_EMAIL }}
          FORGE_API_TOKEN: ${{ secrets.FORGE_API_TOKEN }}
        with:
          forge-cli-version: "12"
          working-directory: "."
          pre-run: |
            npm ci
          usage-analytics: "true"
          environment: "staging"
          deploy: "true"
          install: "true"
          site: ${{ vars.ATLASSIAN_SITE }}
          product: ${{ vars.ATLASSIAN_PRODUCT }}
          upgrade: "true"
          confirm-scopes: "true"
```

Notes:

- Replace `your-org/a9-forge-ci@v1` with the real `owner/repo@tag` for the published action.
- If you do not use GitHub environment variables, set `site` and `product` directly in the workflow.
- `confirm-scopes: "true"` is useful in staging, but you might prefer tighter control in production.

## Step 4: Configure deployment to production

A common and safe production workflow is:

- Deploy to staging on merges to `main`
- Deploy to production only on tags (or manual dispatch)
- Do not run `forge install` in production unless you have a specific policy for it

### Production deploy on version tags

This example deploys to production on tags like `v1.2.3`.

```yaml
on:
  push:
    tags:
      - "v*"

jobs:
  deploy_production:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Deploy only (production)
        uses: your-org/a9-forge-ci@v1
        env:
          FORGE_EMAIL: ${{ secrets.FORGE_EMAIL }}
          FORGE_API_TOKEN: ${{ secrets.FORGE_API_TOKEN }}
        with:
          forge-cli-version: "12"
          working-directory: "."
          pre-run: |
            npm ci
          usage-analytics: "true"
          environment: "production"
          deploy: "true"
          install: "false"
```

Why deploy-only in production:

- Some changes, especially major updates, can require explicit approval in the product UI.
- Many teams prefer a controlled approval path for production installs and scope changes.

If you want production installs too, set `install: "true"` and provide `site` and `product`.

## Reference workflow

This reference combines:
- lint on every push to `main`
- staging deploy and install on `main`
- production deploy on tags

```yaml
name: Forge CD

on:
  push:
    branches: [ main ]
    tags:
      - "v*"

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - name: Install deps and lint
        run: |
          npm ci
          npx @forge/cli@12 settings set usage-analytics true
          npx @forge/cli@12 lint

  deploy_staging:
    if: startsWith(github.ref, 'refs/heads/')
    runs-on: ubuntu-latest
    environment: staging
    needs: [ lint ]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - name: Deploy and upgrade install (staging)
        uses: your-org/a9-forge-ci@v1
        env:
          FORGE_EMAIL: ${{ secrets.FORGE_EMAIL }}
          FORGE_API_TOKEN: ${{ secrets.FORGE_API_TOKEN }}
        with:
          forge-cli-version: "12"
          working-directory: "."
          pre-run: |
            npm ci
          usage-analytics: "true"
          environment: "staging"
          deploy: "true"
          install: "true"
          site: ${{ vars.ATLASSIAN_SITE }}
          product: ${{ vars.ATLASSIAN_PRODUCT }}
          upgrade: "true"
          confirm-scopes: "true"

  deploy_production:
    if: startsWith(github.ref, 'refs/tags/')
    runs-on: ubuntu-latest
    environment: production
    needs: [ lint ]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - name: Deploy only (production)
        uses: your-org/a9-forge-ci@v1
        env:
          FORGE_EMAIL: ${{ secrets.FORGE_EMAIL }}
          FORGE_API_TOKEN: ${{ secrets.FORGE_API_TOKEN }}
        with:
          forge-cli-version: "12"
          working-directory: "."
          pre-run: |
            npm ci
          usage-analytics: "true"
          environment: "production"
          deploy: "true"
          install: "false"
```

## Inputs and outputs

### Authentication

This action expects authentication via environment variables:

- `FORGE_EMAIL`
- `FORGE_API_TOKEN`

### Inputs

- `forge-cli-version`: Version of `@forge/cli` to install. Example: `12` or `12.5.0`. Default: `latest`.
- `working-directory`: Directory where your Forge app lives. Default: `.`.
- `pre-run`: Optional multi-line commands to run before Forge commands (example: `npm ci`).
- `pre-run-shell`: Shell used for `pre-run` (`bash` or `pwsh`). Default: `bash`.
- `usage-analytics`: Set Forge usage analytics setting (`true` or `false`). Default: `true`.
- `environment`: Forge environment name. Default: `staging`.

Deploy controls:
- `deploy`: Run `forge deploy` (`true` or `false`). Default: `true`.
- `no-verify`: Pass `--no-verify` to deploy (`true` or `false`). Default: `false`.
- `deploy-tag`: Optional deploy tag (maps to `forge deploy --tag`).
- `deploy-major-version`: Optional major version (maps to `forge deploy --major-version`).
- `deploy-args`: Extra arguments appended to `forge deploy`.

Install controls:
- `install`: Run `forge install` (`true` or `false`). Default: `false`.
- `site`: Atlassian site domain, required when `install=true`.
- `product`: Product name (`jira`, `confluence`, `compass`, `bitbucket`), required when `install=true`.
- `upgrade`: Pass `--upgrade` (`true` or `false`). Default: `true`.
- `confirm-scopes`: Pass `--confirm-scopes` (`true` or `false`). Default: `true`.
- `install-major-version`: Optional major version (maps to `forge install --major-version`).
- `install-args`: Extra arguments appended to `forge install`.

Override:
- `run`: Run an arbitrary Forge CLI command instead of deploy and install (example: `lint`).

### Outputs

- `deployed`: `true` if deploy ran successfully.
- `installed`: `true` if install ran successfully.
- `forge_cli_version`: The value of `forge --version`.

## Troubleshooting

### Auth failures

Symptoms:
- `You are not logged in`
- `401` or `403`

Fix:
- Confirm `FORGE_EMAIL` and `FORGE_API_TOKEN` are set as secrets.
- If using environments, confirm the job includes `environment: staging` or `environment: production`.

### Install failures

Common causes:
- The app was never installed to that site before.
- Wrong site domain or wrong product value.
- You do not have admin rights on the site.

Fix:
- Install the app manually once.
- Verify `site` and `product`.
- Confirm you have admin rights.

### Non-interactive prompts

Symptoms:
- Job hangs
- CLI prompt text appears

Fix:
- Keep `usage-analytics: "true"` (default), or explicitly set it.

## Security notes

- Store `FORGE_API_TOKEN` only as a GitHub secret.
- Prefer GitHub Environments to separate staging and production credentials.
- Protect the production environment with required reviewers.
- Do not deploy from workflows that run on forks. Secrets are not available there by design.
