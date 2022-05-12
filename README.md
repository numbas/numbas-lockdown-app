# Numbas lockdown browser

An Electron app which can be used to launch resources in the Numbas LTI provider, without access to developer tools or most other browser controls.

## To build

You need [NodeJS](https://nodejs.org/en/) and [yarn](https://classic.yarnpkg.com/en/docs/install#debian-stable).

Once you've got NodeJS installed, install yarn.

Copy `config.js.dist` to `config.js` and fill it in.

To run the browser in development mode:

```
yarn start open <URL>
```

To build the executables:

```
yarn build_windows
yarn build_linux
yarn build_max
```

It's technically possible to build the Windows executable on Linux, using Wine, but it seems to produce a much bigger package than building on Windows.
