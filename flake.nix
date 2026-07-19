{
  description = "Vex Code development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { nixpkgs, ... }:
    let
      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          inherit (pkgs) lib;

          pnpm = pkgs.writeShellApplication {
            name = "pnpm";
            runtimeInputs = [ pkgs.nodejs_24 ];
            text = ''
              exec corepack pnpm "$@"
            '';
          };

          vitePlus = pkgs.writeShellApplication {
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
          default = pkgs.mkShell {
            packages =
              with pkgs;
              [
                nodejs_24
                pnpm
                vitePlus
                bun
                git
                openssh
                python3
                pkg-config
                gnumake
                stdenv.cc
              ]
              ++ lib.optionals pkgs.stdenv.isDarwin [ libiconv ];

            PYTHON = "${pkgs.python3}/bin/python3";

            shellHook = ''
              export VEX_CODE_ROOT="$PWD"
              export PATH="$PWD/node_modules/.bin:$PATH"
            '';
          };
        }
      );
    };
}
