{
  description = "Vex Code development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      forAllSystems =
        f:
        nixpkgs.lib.genAttrs [
          "x86_64-linux"
          "aarch64-linux"
          "aarch64-darwin"
        ] (system: f nixpkgs.legacyPackages.${system});

      vitePlusFor =
        pkgs:
        pkgs.writeShellApplication {
          name = "vp";
          runtimeInputs = [
            pkgs.git
            pkgs.nodejs_24
          ];
          text = ''
            root="''${VEX_CODE_ROOT:-}"
            if [[ -z "$root" ]]; then
              root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
            fi

            if [[ -x "$root/node_modules/.bin/vp" ]]; then
              exec "$root/node_modules/.bin/vp" "$@"
            fi

            exec corepack pnpm --package=vite-plus@0.2.2 dlx vp "$@"
          '';
        };
    in
    {
      devShells = forAllSystems (
        pkgs:
        let
          pnpm = pkgs.writeShellApplication {
            name = "pnpm";
            runtimeInputs = [ pkgs.nodejs_24 ];
            text = ''
              exec corepack pnpm "$@"
            '';
          };
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_24
              pnpm
              (vitePlusFor pkgs)
              pkgs.bun
              pkgs.git
              pkgs.openssh
              pkgs.python3
              pkgs.pkg-config
              pkgs.gnumake
              pkgs.stdenv.cc
              pkgs.nixfmt
              pkgs.statix
              pkgs.deadnix
            ]
            ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isDarwin [ pkgs.libiconv ];

            PYTHON = "${pkgs.python3}/bin/python3";

            shellHook = ''
              export VEX_CODE_ROOT="$PWD"
              export PATH="$PWD/node_modules/.bin:$PATH"
            '';
          };
        }
      );

      # `nix fmt` passes no paths, so the formatter finds its own files.
      # .repos/ holds vendored references we never edit.
      formatter = forAllSystems (
        pkgs:
        pkgs.writeShellApplication {
          name = "format";
          runtimeInputs = [
            pkgs.git
            pkgs.nixfmt
            (vitePlusFor pkgs)
          ];
          text = ''
            cd "$(git rev-parse --show-toplevel)"
            git ls-files --cached --others --exclude-standard -z '*.nix' ':!.repos' | xargs -0 -r nixfmt
            vp fmt
          '';
        }
      );
    };
}
