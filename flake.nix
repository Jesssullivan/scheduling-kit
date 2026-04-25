{
  description = "scheduling-kit dev shell and lightweight docs/release checks";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    let
      packageJson = builtins.fromJSON (builtins.readFile ./package.json);
    in
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        docsPython = pkgs.python313.withPackages (ps: [
          ps.mkdocs
          ps.mkdocs-material
          ps.pymdown-extensions
        ]);

        bazelWrapper = pkgs.writeShellApplication {
          name = "bazel";
          runtimeInputs = [ pkgs.nodejs_22 ];
          text = ''
            exec npx --yes @bazel/bazelisk "$@"
          '';
        };

        docsSite = pkgs.stdenvNoCC.mkDerivation {
          pname = "scheduling-kit-docs";
          version = packageJson.version;
          src = ./.;
          nativeBuildInputs = [
            pkgs.nodejs_22
            docsPython
          ];
          dontConfigure = true;
          buildPhase = ''
            runHook preBuild
            export HOME="$TMPDIR/home"
            mkdir -p "$HOME"
            cp -r "$src" source
            chmod -R u+w source
            cd source
            node scripts/generate-doc-artifacts.mjs
            mkdocs build --strict
            runHook postBuild
          '';
          installPhase = ''
            runHook preInstall
            mkdir -p "$out"
            cp -r site/* "$out"/
            runHook postInstall
          '';
        };

        releaseMetadataCheck = pkgs.runCommand "scheduling-kit-release-metadata-${packageJson.version}" {
          nativeBuildInputs = [ pkgs.nodejs_22 ];
          src = ./.;
        } ''
          cp -r "$src" source
          chmod -R u+w source
          cd source
          node scripts/check-release-metadata.mjs
          touch "$out"
        '';
      in
      {
        packages.docs = docsSite;

        checks.docs = docsSite;
        checks.release-metadata = releaseMetadataCheck;

        devShells.default = pkgs.mkShellNoCC {
          packages = with pkgs; [
            actionlint
            bazelWrapper
            docsPython
            jdk21_headless
            nodejs_22
            pnpm
            typescript
            typescript-language-server
          ];

          shellHook = ''
            echo "scheduling-kit dev shell"
            echo "Node: $(node --version)"
            echo "pnpm: $(pnpm --version)"
            echo "bazel: wrapper via npx @bazel/bazelisk $(cat .bazelversion)"
            echo "mkdocs: $(mkdocs --version | cut -d',' -f1)"
          '';
        };
      }
    );
}
