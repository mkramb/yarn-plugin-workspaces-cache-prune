import { Option } from "clipanion";
import { BaseCommand, WorkspaceRequiredError } from "@yarnpkg/cli";
import {
  Cache,
  Configuration,
  Manifest,
  Plugin,
  Project,
  StreamReport,
  structUtils,
  Workspace,
} from "@yarnpkg/core";

class WorkspacesCachePruneCommand extends BaseCommand {
  static paths = [[`workspaces-cache-prune`]];

  json = Option.Boolean(`--json`, false, {
    description: `Format the output as an NDJSON stream`,
  });

  production = Option.Boolean(`--production`, false, {
    description: `Only install regular dependencies by omitting dev dependencies`,
  });

  workspaces = Option.Rest();

  async execute() {
    const configuration = await Configuration.find(this.context.cwd, this.context.plugins);
    const { project, workspace } = await Project.find(configuration, this.context.cwd);
    const cache = await Cache.find(configuration);

    await project.restoreInstallState({
      restoreResolutions: false,
    });

    let requiredWorkspaces: Set<Workspace>;

    if (this.workspaces.length === 0) {
      if (!workspace) throw new WorkspaceRequiredError(project.cwd, this.context.cwd);

      requiredWorkspaces = new Set([workspace]);
    } else {
      requiredWorkspaces = new Set(
        this.workspaces.map((name) => {
          return project.getWorkspaceByIdent(structUtils.parseIdent(name));
        })
      );
    }

    // First we compute the dependency chain to see what workspaces are
    // dependencies of the one we're trying to focus on.

    for (const workspace of requiredWorkspaces) {
      for (const dependencyType of this.production ? [`dependencies`] : Manifest.hardDependencies) {
        for (const descriptor of workspace.manifest.getForScope(dependencyType).values()) {
          const matchingWorkspace = project.tryWorkspaceByDescriptor(descriptor);

          if (matchingWorkspace === null) continue;

          requiredWorkspaces.add(matchingWorkspace);
        }
      }
    }

    // Then we go over each workspace that didn't get selected,
    // and remove all their dependencies.

    for (const workspace of project.workspaces) {
      if (requiredWorkspaces.has(workspace)) {
        if (this.production) {
          workspace.manifest.devDependencies.clear();
        }
      } else {
        workspace.manifest.installConfig = workspace.manifest.installConfig || {};
        workspace.manifest.installConfig.selfReferences = false;
        workspace.manifest.dependencies.clear();
        workspace.manifest.devDependencies.clear();
        workspace.manifest.peerDependencies.clear();
        workspace.manifest.scripts.clear();
      }
    }

    // And finally we need to resolve & link everything,
    // and then update the cache with unused dependencies

    const report = await StreamReport.start(
      {
        configuration,
        json: this.json,
        stdout: this.context.stdout,
        includeLogs: true,
      },
      async (report: StreamReport) => {
        await project.resolveEverything({ cache, report });
        await project.linkEverything({ cache, report });
        await project.cacheCleanup({ cache, report });
      }
    );

    return report.exitCode();
  }
}

const plugin: Plugin = {
  commands: [WorkspacesCachePruneCommand],
};

export default plugin;
