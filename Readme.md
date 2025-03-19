# Preparation

## Install the required packages
(untested)

```bash
brew install nvm
nvm use node
npm install
```

## Open Chrome and allow it to talk to node

- start Google Chrome:
`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=21222`

- then go to https://isa.epfl.ch/imoniteur_ISAP/isacademia.htm
- log in with your credentials

This way you don't need to type your password in the terminal
and you can use the password manager.

The session remembers you've logged in, so the script assumes this

Keep the first tab open to not lose your session. this script works with the 2nd tab, because it allows us to have an inspector open there

# Runnin the script
```bash
mkdir /path/to/destination/folder
node scrape-interns.js /path/to/destination/folder
```
