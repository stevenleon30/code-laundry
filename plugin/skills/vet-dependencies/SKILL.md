---
name: vet-dependencies
description: Check npm packages with Code Laundry before installing or importing them. Use before running npm/pnpm/yarn add or install with a new package, when adding an import of a package not yet in package.json, or when the user asks whether a package is safe, real, or vulnerable.
---

Before adding an npm package, confirm it is real and safe.

1. Call the `check_dependencies` tool:
   - for new packages: `imports: ["name"]`, or `["name@version"]` when a version is chosen
   - for a whole project: `packageJson` with the contents of package.json
   - pass `context.projectRoot` when working in a repository
2. Read the result:
   - `deps/not-found` or `deps/removed-malicious`: the package doesn't exist or was removed as malware. Don't install it. If the finding suggests a similarly named popular package, check that one instead; otherwise pick a well-known package or implement the functionality locally.
   - `deps/typosquat`: use the popular package the finding names, unless the user really meant this one.
   - `deps/vulnerable`: use the fixed version the finding names, or newer.
   - `deps/deprecated`, `deps/new-package`, `deps/low-downloads`: tell the user and prefer an established alternative.
3. Only run the install command once the packages you're adding pass.

If the result notes that the registry or vulnerability database couldn't be reached, say that those checks didn't run rather than treating the package as safe.
