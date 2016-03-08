#!/usr/bin/env bash

set -e

PATH="$(npm bin):$PATH"
hasChanges() {
  git status >/dev/null # update the cache
  if git diff-index --quiet HEAD --; then
    return 1
  else
    return 0
  fi
}

# Get the current version.
VERSION=$(node -e 'console.log(require("./package.json").version)')

# Build the browser version.
browserify -e dist/index.js -s decaf -o dist/decaf.js

# Switch to gh-pages branch.
git fetch origin
git checkout gh-pages
git reset --hard origin/gh-pages || echo "No updates from server."

# Update the script in the gh-pages branch.
mv dist/decaf.js scripts/
perl -p -i -e "s/v\d+\.\d+\.\d+/v$VERSION/" index.html
if hasChanges; then
  git commit -av -m "Update decaf.js."
  git push origin gh-pages
fi

# Go back to the master branch.
git checkout master