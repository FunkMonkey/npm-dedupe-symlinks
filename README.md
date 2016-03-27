## npm-dedupe-symlinks

**ATTENTION: this command messes with your directory structure. In its current
state it should be used with caution. Make a backup of your project first.**

`npm dedupe` ignores modules that are symbolic links (e. g. when using `npm link`)
resulting in incomplete deduplication.

Thus `npm-dedupe-symlinks` was created to dedupe the current working directory,
even if the `node_modules` folder contains symbolic links. It does so by creating
a directory structure without any symbolic links, then using `npm dedupe` and
recreating the symbolic links.

It can handle the following constellations:
- `my-package/node_modules/symlinkedModule`
- `my-package/node_modules/@symlinkedScope/module`
- `my-package/node_modules/@scope/symlinkedModule`

It currently does not work for symbolic links that are nested deeper in the
directory hierarchy than one level (except for linked modules inside `@scopes`).

### Usage

```
npm install -g npm-dedupe-symlinks

cd /to/the/package/i/want/to/dedupe

npm-dedupe-symlinks
```
If the command fails, you may need to re-create your symbolic links. Dependencies
might be lost as well.

### Development

```
# after cloning, run once
npm run build

# there's also a watcher
npm run watch:build
```

### FAQ

#### How does it work?

1. unlink linked modules (only on the first level)
2. create an empty directory in its place
3. move the `node_modules` directory from the link's target to the empty directory
4. run `npm dedupe`
5. move the module's deduped `node_modules` directory (if it still exists) back
to the link target
6. delete the directory, which is now empty again
7. re-link the modules (create symbolic links)

It uses [RxJS](https://github.com/Reactive-Extensions/RxJS) internally.

#### Moving the `node_modules` directory is slow

Make sure everything is on the same volume.

### TODO

- write some tests
