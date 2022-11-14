import { readdirSync, unlinkSync } from "fs";
import { Option } from "clipanion";
import { BaseCommand, WorkspaceRequiredError } from "@yarnpkg/cli";
import {
  Cache,
  Configuration,
  Descriptor,
  IdentHash,
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
    const configuration = await Configuration.find(this.context.cwd, this.context.plugins);
    const { project, workspace } = await Project.find(configuration, this.context.cwd);

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
        for (const descriptor of workspace.manifest.getForScope(dependencyType).values()) {
          const matchingWorkspace = project.tryWorkspaceByDescriptor(descriptor);

          if (matchingWorkspace === null) continue;
          requiredWorkspaces.add(matchingWorkspace);
        }
      }
    }

    // We continue with resolving project dependencies
    // and gathering all workspace dependencies

    const cache = await Cache.find(configuration);
    const dependenciesToKeep: Map<string, true> = new Map();

    await project.resolveEverything({ cache, report: new ThrowReport() });
    await project.fetchEverything({ cache, report: new ThrowReport() });

    project.forgetVirtualResolutions();

    const loadTransitiveDependencies = (dependencies: Map<IdentHash, Descriptor>) => {
      for (const depDescriptor of dependencies.values()) {
        const depPackage = project.storedPackages.get(project.storedResolutions.get(depDescriptor.descriptorHash));
        const depPackageSlug = structUtils.slugifyLocator(depPackage);

        if (!dependenciesToKeep.has(depPackageSlug)) {
          dependenciesToKeep.set(depPackageSlug, true);
          loadTransitiveDependencies(depPackage.dependencies);
        }
      }
    };

    for (const storedPackage of project.storedPackages.values()) {
      const storedPackageSlug = structUtils.slugifyLocator(storedPackage);

      for (const requiredWorkspace of requiredWorkspaces) {
        if (requiredWorkspace.manifest.hasDependency(storedPackage)) {
          dependenciesToKeep.set(storedPackageSlug, true);
          loadTransitiveDependencies(storedPackage.dependencies);
        }
      }
    }

    // Finally, lets prune cache of items that are not needed

    const cacheFiles = readdirSync(cache.cwd);

    for (const fileName of cacheFiles) {
      const matches = fileName.match(/(.*)-.+/);

      if (!matches || dependenciesToKeep.get(matches[1]) !== true) {
        unlinkSync(`${cache.cwd}/${fileName}`);
      }
    }

    console.log("Cache pruned for selected workspaces.");
  }
}

const plugin: Plugin = {
  commands: [WorkspacesCachePruneCommand],
};

export default plugin;
