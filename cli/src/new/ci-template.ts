export const YAML = (app: string) => `
name: CI

env:
  DEBUG: 'napi:*'
  APP_NAME: '${app}'
  MACOSX_DEPLOYMENT_TARGET: '10.13'

on:
  push:
    branches:
      - main
    tags-ignore:
      - '**'
  pull_request:

jobs:
  build:
    if: "!contains(github.event.head_commit.message, 'skip ci')"

    strategy:
      fail-fast: false
      matrix:
        settings:
          - host: macos-latest
            target: 'x86_64-apple-darwin'
            build: yarn build
          - host: windows-latest
            build: yarn build
            target: 'x86_64-pc-windows-msvc'
          - host: windows-latest
            build: |
              export CARGO_PROFILE_RELEASE_CODEGEN_UNITS=32;
              export CARGO_PROFILE_RELEASE_LTO=false
              yarn build --target i686-pc-windows-msvc
              yarn test
            target: 'i686-pc-windows-msvc'
            setup: |
              choco install nodejs-lts --x86 -y --force
              echo "C:\\Program Files (x86)\\nodejs" >> $GITHUB_PATH
          - host: ubuntu-latest
            target: 'x86_64-unknown-linux-gnu'
            docker: |
              docker login -u $DOCKER_USERNAME -p $DOCKER_PASSWORD $DOCKER_REGISTRY_URL
              docker pull $DOCKER_REGISTRY_URL/napi-rs/napi-rs/nodejs-rust:lts-debian
              docker tag $DOCKER_REGISTRY_URL/napi-rs/napi-rs/nodejs-rust:lts-debian builder
            build: |
              docker run --rm -v ~/.cargo/git:/root/.cargo/git -v ~/.cargo/registry:/root/.cargo/registry -v $(pwd):/build -w /build builder yarn build && strip ${app}.linux-x64-gnu.node
          - host: ubuntu-latest
            target: 'x86_64-unknown-linux-musl'
            docker: |
              docker login -u $DOCKER_USERNAME -p $DOCKER_PASSWORD $DOCKER_REGISTRY_URL
              docker pull $DOCKER_REGISTRY_URL/napi-rs/napi-rs/nodejs-rust:lts-alpine
              docker tag $DOCKER_REGISTRY_URL/napi-rs/napi-rs/nodejs-rust:lts-alpine builder
            build: docker run --rm -v ~/.cargo/git:/root/.cargo/git -v ~/.cargo/registry:/root/.cargo/registry -v $(pwd):/build -w /build builder yarn build && strip ${app}.linux-x64-musl.node
          - host: macos-latest
            target: 'aarch64-apple-darwin'
            build: yarn build --target=aarch64-apple-darwin
          - host: ubuntu-latest
            target: 'aarch64-unknown-linux-gnu'
            setup: |
              sudo apt-get install g++-aarch64-linux-gnu gcc-aarch64-linux-gnu -y
            build: |
              yarn build --target=aarch64-unknown-linux-gnu
              aarch64-linux-gnu-strip ${app}.linux-arm64-gnu.node
          - host: ubuntu-latest
            target: 'armv7-unknown-linux-gnueabihf'
            setup: |
              sudo apt-get install gcc-arm-linux-gnueabihf g++-arm-linux-gnueabihf -y
            build: |
              yarn build --target=armv7-unknown-linux-gnueabihf
              arm-linux-gnueabihf-strip ${app}.linux-arm-gnueabihf.node
          - host: ubuntu-latest
            target: 'aarch64-linux-android'
            build: |
              export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="\${ANDROID_NDK_HOME}/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android24-clang"
              yarn build --target aarch64-linux-android
          - host: ubuntu-latest
            target: 'aarch64-unknown-linux-musl'
            downloadTarget: 'aarch64-unknown-linux-musl'
            docker: |
              docker login -u $DOCKER_USERNAME -p $DOCKER_PASSWORD $DOCKER_REGISTRY_URL
              docker pull ghcr.io/napi-rs/napi-rs/nodejs-rust:lts-alpine
              docker tag ghcr.io/napi-rs/napi-rs/nodejs-rust:lts-alpine builder
            build: |
              docker run --rm -v ~/.cargo/git:/root/.cargo/git -v ~/.cargo/registry:/root/.cargo/registry -v $(pwd):/build -w /build builder sh -c "yarn build --target=aarch64-unknown-linux-musl && /aarch64-linux-musl-cross/bin/aarch64-linux-musl-strip ${app}.linux-arm64-musl.node"
          - host: windows-latest
            target: 'aarch64-pc-windows-msvc'
            build: yarn build --target aarch64-pc-windows-msvc

    name: stable - \${{ matrix.settings.target }} - node@14
    runs-on: \${{ matrix.settings.host }}

    steps:
      - uses: actions/checkout@v2

      - name: Setup node
        uses: actions/setup-node@v2
        with:
          node-version: 14
          check-latest: true

      - name: Install
        uses: actions-rs/toolchain@v1
        with:
          profile: minimal
          override: true
          toolchain: stable
          target: \${{ matrix.settings.target }}

      - name: Generate Cargo.lock
        uses: actions-rs/cargo@v1
        with:
          command: generate-lockfile

      - name: Cache cargo registry
        uses: actions/cache@v2
        with:
          path: ~/.cargo/registry
          key: \${{ matrix.settings.target }}-node@14-cargo-registry-trimmed-\${{ hashFiles('**/Cargo.lock') }}

      - name: Cache cargo index
        uses: actions/cache@v2
        with:
          path: ~/.cargo/git
          key: \${{ matrix.settings.target }}-node@14-cargo-index-trimmed-\${{ hashFiles('**/Cargo.lock') }}

      - name: Cache NPM dependencies
        uses: actions/cache@v2
        with:
          path: node_modules
          key: npm-cache-\${{ matrix.settings.target }}-node@14-\${{ hashFiles('yarn.lock') }}

      - name: Pull latest image
        run: \${{ matrix.settings.docker }}
        env:
          DOCKER_REGISTRY_URL: ghcr.io
          DOCKER_USERNAME: \${{ github.actor }}
          DOCKER_PASSWORD: \${{ secrets.GITHUB_TOKEN }}
        if: \${{ matrix.settings.docker }}

      - name: Setup toolchain
        run: \${{ matrix.settings.setup }}
        if: \${{ matrix.settings.setup }}
        shell: bash

      - name: 'Install dependencies'
        run: yarn install --ignore-scripts --frozen-lockfile --registry https://registry.npmjs.org --network-timeout 300000

      - name: 'Build'
        run: \${{ matrix.settings.build }}
        shell: bash

      - name: Upload artifact
        uses: actions/upload-artifact@v2
        with:
          name: bindings-\${{ matrix.settings.target }}
          path: \${{ env.APP_NAME }}.*.node

  build-freebsd:
    runs-on: macos-latest
    name: Build FreeBSD
    steps:
      - uses: actions/checkout@v2
      - name: Build
        id: build
        uses: vmactions/freebsd-vm@v0.1.5
        env:
          DEBUG: 'napi:*'
          RUSTUP_HOME: /usr/local/rustup
          CARGO_HOME: /usr/local/cargo
          RUSTUP_IO_THREADS: 1
        with:
          envs: 'DEBUG RUSTUP_HOME CARGO_HOME RUSTUP_IO_THREADS'
          usesh: true
          mem: 3000
          prepare: |
            pkg install -y curl node yarn npm python2
            curl https://sh.rustup.rs -sSf --output rustup.sh
            sh rustup.sh -y --profile minimal --default-toolchain stable
            export PATH="/usr/local/cargo/bin:$PATH"
            echo "~~~~ rustc --version ~~~~"
            rustc --version
            echo "~~~~ node -v ~~~~"
            node -v
            echo "~~~~ yarn --version ~~~~"
            yarn --version
          run: |
            export PATH="/usr/local/cargo/bin:$PATH"
            pwd
            ls -lah
            whoami
            env
            freebsd-version
            yarn install --ignore-scripts --frozen-lockfile --registry https://registry.npmjs.org --network-timeout 300000
            yarn build
            yarn test
            rm -rf node_modules
            rm -rf target
      - name: Upload artifact
        uses: actions/upload-artifact@v2
        with:
          name: bindings-freebsd
          path: \${{ env.APP_NAME }}.*.node

  test-macOS-windows-binding:
    name: Test bindings on \${{ matrix.settings.target }} - node@\${{ matrix.node }}
    needs:
      - build
    strategy:
      fail-fast: false
      matrix:
        settings:
          - host: macos-latest
            target: 'x86_64-apple-darwin'
          - host: windows-latest
            target: 'x86_64-pc-windows-msvc'
        node: ['12', '14', '16']
    runs-on: \${{ matrix.settings.host }}

    steps:
      - uses: actions/checkout@v2

      - name: Setup node
        uses: actions/setup-node@v2
        with:
          node-version: \${{ matrix.node }}
          check-latest: true

      - name: Cache NPM dependencies
        uses: actions/cache@v2
        with:
          path: node_modules
          key: npm-cache-test-\${{ matrix.settings.target }}-\${{ matrix.node }}-\${{ hashFiles('yarn.lock') }}

      - name: 'Install dependencies'
        run: yarn install --ignore-scripts --frozen-lockfile --registry https://registry.npmjs.org --network-timeout 300000

      - name: Download artifacts
        uses: actions/download-artifact@v2
        with:
          name: bindings-\${{ matrix.settings.target }}
          path: .

      - name: List packages
        run: ls -R .
        shell: bash

      - name: Test bindings
        run: yarn test

  test-linux-x64-gnu-binding:
    name: Test bindings on Linux-x64-gnu - node@\${{ matrix.node }}
    needs:
      - build
    strategy:
      fail-fast: false
      matrix:
        node: ['12', '14', '16']
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v2

      - name: Setup node
        uses: actions/setup-node@v2
        with:
          node-version: \${{ matrix.node }}
          check-latest: true

      - name: Cache NPM dependencies
        uses: actions/cache@v2
        with:
          path: node_modules
          key: npm-cache-test-linux-x64-gnu-\${{ matrix.node }}-\${{ hashFiles('yarn.lock') }}

      - name: 'Install dependencies'
        run: yarn install --ignore-scripts --frozen-lockfile --registry https://registry.npmjs.org --network-timeout 300000

      - name: Download artifacts
        uses: actions/download-artifact@v2
        with:
          name: bindings-x86_64-unknown-linux-gnu
          path: .

      - name: List packages
        run: ls -R .
        shell: bash

      - name: Test bindings
        run: docker run --rm -v $(pwd):/${app} -w /${app} node:\${{ matrix.node }}-slim yarn test

  test-linux-x64-musl-binding:
    name: Test bindings on x86_64-unknown-linux-musl - node@\${{ matrix.node }}
    needs:
      - build
    strategy:
      fail-fast: false
      matrix:
        node: ['12', '14', '16']
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v2

      - name: Setup node
        uses: actions/setup-node@v2
        with:
          node-version: \${{ matrix.node }}
          check-latest: true

      - name: Cache NPM dependencies
        uses: actions/cache@v2
        with:
          path: node_modules
          key: npm-cache-test-x86_64-unknown-linux-musl-\${{ matrix.node }}-\${{ hashFiles('yarn.lock') }}

      - name: 'Install dependencies'
        run: yarn install --ignore-scripts --frozen-lockfile --registry https://registry.npmjs.org --network-timeout 300000

      - name: Download artifacts
        uses: actions/download-artifact@v2
        with:
          name: bindings-x86_64-unknown-linux-musl
          path: .

      - name: List packages
        run: ls -R .
        shell: bash

      - name: Test bindings
        run: docker run --rm -v $(pwd):/${app} -w /${app} node:\${{ matrix.node }}-alpine yarn test

  test-linux-aarch64-gnu-binding:
    name: Test bindings on aarch64-unknown-linux-gnu - node@\${{ matrix.node }}
    needs:
      - build
    strategy:
      fail-fast: false
      matrix:
        node: ['12', '14', '16']
    runs-on: ubuntu-latest

    steps:
      - run: docker run --rm --privileged multiarch/qemu-user-static:register --reset

      - uses: actions/checkout@v2

      - name: Download artifacts
        uses: actions/download-artifact@v2
        with:
          name: bindings-aarch64-unknown-linux-gnu
          path: .

      - name: List packages
        run: ls -R .
        shell: bash

      - name: Setup and run tests
        uses: docker://multiarch/ubuntu-core:arm64-focal
        with:
          args: >
            sh -c "
              apt-get update && \\
              apt-get install -y ca-certificates gnupg2 curl apt-transport-https && \\
              curl -sL https://deb.nodesource.com/setup_\${{ matrix.node }}.x | bash - && \\
              apt-get install -y nodejs && \\
              npm install -g yarn && \\
              yarn install --ignore-scripts --registry https://registry.npmjs.org --network-timeout 300000 && \\
              yarn test && \\
              ls -la
            "
  test-linux-aarch64-musl-binding:
    name: Test bindings on aarch64-unknown-linux-musl - node@\${{ matrix.node }}
    needs:
      - build

    runs-on: ubuntu-latest

    steps:
      - run: docker run --rm --privileged multiarch/qemu-user-static:register --reset

      - uses: actions/checkout@v2

      - name: Download artifacts
        uses: actions/download-artifact@v2
        with:
          name: bindings-aarch64-unknown-linux-musl
          path: .

      - name: List packages
        run: ls -R .
        shell: bash

      - name: Setup and run tests
        uses: docker://multiarch/alpine:aarch64-latest-stable
        with:
          args: >
            sh -c "
              apk add nodejs npm && \\
              npm install -g yarn && \\
              yarn install --ignore-scripts --registry https://registry.npmjs.org --network-timeout 300000 && \\
              npm test
            "
  test-linux-arm-gnueabihf-binding:
    name: Test bindings on armv7-unknown-linux-gnueabihf - node@\${{ matrix.node }}
    needs:
      - build
    strategy:
      fail-fast: false
      matrix:
        node: ['12', '14', '16']
    runs-on: ubuntu-latest

    steps:
      - run: docker run --rm --privileged multiarch/qemu-user-static:register --reset

      - uses: actions/checkout@v2

      - name: Download artifacts
        uses: actions/download-artifact@v2
        with:
          name: bindings-armv7-unknown-linux-gnueabihf
          path: .

      - name: List packages
        run: ls -R .
        shell: bash

      - name: Setup and run tests
        uses: docker://multiarch/ubuntu-core:armhf-focal
        with:
          args: >
            sh -c "
              apt-get update && \\
              apt-get install -y ca-certificates gnupg2 curl apt-transport-https && \\
              curl -sL https://deb.nodesource.com/setup_\${{ matrix.node }}.x | bash - && \\
              apt-get install -y nodejs && \\
              npm install -g yarn && \\
              yarn install --ignore-scripts --registry https://registry.npmjs.org --network-timeout 300000 && \\
              yarn test && \\
              ls -la
            "
  publish:
    name: Publish
    runs-on: ubuntu-latest
    needs:
      - test-linux-x64-gnu-binding
      - test-linux-x64-musl-binding
      - test-linux-aarch64-gnu-binding
      - test-linux-arm-gnueabihf-binding
      - test-macOS-windows-binding
      - test-linux-aarch64-musl-binding
      - build-freebsd

    steps:
      - uses: actions/checkout@v2

      - name: Setup node
        uses: actions/setup-node@v2
        with:
          node-version: 14
          check-latest: true

      - name: Cache NPM dependencies
        uses: actions/cache@v2
        with:
          path: node_modules
          key: npm-cache-ubuntu-latest-\${{ hashFiles('yarn.lock') }}
          restore-keys: |
            npm-cache-
      - name: 'Install dependencies'
        run: yarn install --ignore-scripts --frozen-lockfile --registry https://registry.npmjs.org --network-timeout 300000

      - name: Download all artifacts
        uses: actions/download-artifact@v2
        with:
          path: artifacts

      - name: Move artifacts
        run: yarn artifacts

      - name: List packages
        run: ls -R ./npm
        shell: bash

      - name: Publish
        run: |
          if git log -1 --pretty=%B | grep "^[0-9]\\+\\.[0-9]\\+\\.[0-9]\\+$";
          then
            echo "//registry.npmjs.org/:_authToken=$NPM_TOKEN" >> ~/.npmrc
            npm publish --access public
          elif git log -1 --pretty=%B | grep "^[0-9]\\+\\.[0-9]\\+\\.[0-9]\\+";
          then
            echo "//registry.npmjs.org/:_authToken=$NPM_TOKEN" >> ~/.npmrc
            npm publish --tag next --access public
          else
            echo "Not a release, skipping publish"
          fi
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: \${{ secrets.NPM_TOKEN }}
`
