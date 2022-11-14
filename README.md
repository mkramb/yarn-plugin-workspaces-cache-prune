# yarn-workspaces-cache-prune

This plugin adds support for pruning items from cache for a given yarn workspace.

## Install

```
yarn plugin import https://raw.githubusercontent.com/mkramb/yarn-plugin-workspaces-cache-prune/master/bundles/%40yarnpkg/plugin-workspaces-cache-prune.js
yarn install
```

## Usage

Navigate to workspace for which you want to prune cache and then execute:

```
yarn workspaces-cache-prune
```

As alternative you can provide multiple workspaces as arguments:

```
yarn workspaces-cache-prune <workspaceA> <workspaceB> <workspaceC>
```