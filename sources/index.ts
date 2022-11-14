import { readdirSync, unlinkSync } from "fs";
import { Option } from "clipanion";
import { BaseCommand, WorkspaceRequiredError } from "@yarnpkg/cli";
import {
  Cache,
  Configuration,
  Manifest,
  Plugin,
  Project,
  structUtils,
  ThrowReport,
  Workspace,
} from "@yarnpkg/core";

class WorkspacesCachePruneCommand extends BaseCommand {
  static paths = [[`workspaces-cache-prune`]];

  workspaces = Option.Rest();

  async execute() {
    const configuration = await Configuration.find(
      this.context.cwd,
      this.context.plugins
    );
    const { project, workspace } = await Project.find(
      configuration,
      this.context.cwd
    );

    let requiredWorkspaces: Set<Workspace>;

    if (this.workspaces.length === 0) {
      if (!workspace) {
        throw new WorkspaceRequiredError(project.cwd, this.context.cwd);
      }

      requiredWorkspaces = new Set([workspace]);
    } else {
      requiredWorkspaces = new Set(
        this.workspaces.map((name) => {
          return project.getWorkspaceByIdent(structUtils.parseIdent(name));
        })
      );
    }

    // First we compute the dependency chain to see what workspaces are
    // dependencies of the current one we're trying to focus on.

    for (const workspace of requiredWorkspaces) {
      for (const dependencyType of Manifest.allDependencies) {
        for (const descriptor of workspace.manifest
          .getForScope(dependencyType)
          .values()) {
          const matchingWorkspace =
            project.tryWorkspaceByDescriptor(descriptor);

          if (matchingWorkspace === null) continue;
          requiredWorkspaces.add(matchingWorkspace);
        }
      }
    }

    // We continue with resolving project dependencies
    // and gathering all workspace dependencies

    const cache = await Cache.find(configuration);
    const dependenciesToKeep: Map<string, boolean> = new Map();

    await project.resolveEverything({
      cache,
      lockfileOnly: true,
      report: new ThrowReport(),
    });

    for (const storedPackage of project.storedPackages.values()) {
      const isVirtualPackage = structUtils.isVirtualLocator(
        structUtils.makeLocator(storedPackage, storedPackage.reference)
      );

      if (!isVirtualPackage) {
        for (const workspace of requiredWorkspaces) {
          if (workspace.manifest.hasDependency(storedPackage)) {
            dependenciesToKeep.set(
              structUtils.slugifyLocator(storedPackage),
              true
            );
          }
        }
      }
    }

    // Finally, lets prune cache of items that are not needed

    const cacheFiles = readdirSync(cache.cwd);

    for (const fileName of cacheFiles) {
      const matches = fileName.match(/(.*-npm-.+)-.*/);

      if (!matches || dependenciesToKeep.get(matches[1]) !== true) {
        unlinkSync(`${cache.cwd}/${fileName}`);
      }
    }

    console.log("Pruned cache for the current workspace.");
  }
}

const plugin: Plugin = {
  commands: [WorkspacesCachePruneCommand],
};

export default plugin;
