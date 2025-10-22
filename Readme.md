# Preparation

## Install the required packages
(untested)

### nvm
```bash
brew install nvm
```

Add the following to your `~/.bash_profile`
```bash
# setup NVM following instructions from brew
# This is too slow, replaced with function, from https://github.com/nvm-sh/nvm/issues/1774
# export NVM_DIR="$HOME/.nvm"
# [ -s "/usr/local/opt/nvm/nvm.sh" ] && \. "/usr/local/opt/nvm/nvm.sh"  # This loads nvm
# [ -s "/usr/local/opt/nvm/etc/bash_completion.d/nvm" ] && \. "/usr/local/opt/nvm/etc/bash_completion.d/nvm"  # This loads nvm bash_completion
alias manpath=false
nvm() {
    unset -f nvm
    export NVM_DIR=~/.nvm
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"  # This loads nvm
    nvm "$@"
}

node() {
    unset -f node
    export NVM_DIR=~/.nvm
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"  # This loads nvm
    node "$@"
}

npm() {
    unset -f npm
    export NVM_DIR=~/.nvm
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"  # This loads nvm
    npm "$@"
}
```

### start using node
```
nvm use node
npm install
```

## Open Chrome and allow it to talk to node

1. in newer versions of Chrome, [it is not allowed to read your data](https://developer.chrome.com/blog/remote-debugging-port) when controlled externally (makes sense !!), so you need to point it to another directory. For our use case, this can be a temporary one:
`mkdir /tmp/temp-chrome-dir`

2. start Google Chrome with the above dir:
`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=21222 --user-data-dir=/tmp/temp-chrome-dir`

3. go to https://isa.epfl.ch/imoniteur_ISAP/isacademia.htm
4. log in with your credentials

This way you don't need to type your password in the terminal
and you can use the password manager.

The session remembers you've logged in, so the script assumes this

Keep the first tab open to not lose your session. this script works with the 2nd tab, because it allows us to have an inspector open there

# Runnin the script
```bash
mkdir /path/to/CVs/destination/folder
node scrape-interns.js /path/to/CVs/destination/folder
```
