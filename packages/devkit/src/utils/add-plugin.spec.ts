jest.mock('vite', () => ({
  resolveConfig: jest.fn().mockImplementation(() => {
    return Promise.resolve({
      path: 'vite.config.ts',
      config: {},
      build: {},
      dependencies: [],
    });
  }),
}));

jest.mock('@nx/vite/plugin', () => ({
  createNodes: [
    '**/vite.config.{js,cjs,mjs}',
    (_, { targetName }) => ({
      projects: {
        app1: {
          name: 'app1',
          targets: {
            [targetName]: { command: 'vite build' },
          },
        },
        app2: {
          name: 'app2',
          targets: {
            [targetName]: { command: 'vite build' },
          },
        },
      },
    }),
  ],
  createDependencies: jest.fn(),
}));

import { createTreeWithEmptyWorkspace } from 'nx/src/generators/testing-utils/create-tree-with-empty-workspace';
import type { Tree } from 'nx/src/generators/tree';
import { readJson, writeJson } from 'nx/src/generators/utils/json';
import type { PackageJson } from 'nx/src/utils/package-json';
import { CreateNodes } from 'nx/src/project-graph/plugins';
import { TempFs } from 'nx/src/internal-testing-utils/temp-fs';

import { addPlugin, generateCombinations } from './add-plugin';
import { updateNxJson } from 'nx/src/generators/utils/nx-json';

describe('addPlugin', () => {
  let tree: Tree;
  let createNodes: CreateNodes<{ targetName: string }>;
  let fs: TempFs;

  beforeEach(async () => {
    tree = createTreeWithEmptyWorkspace();

    fs = new TempFs('add-plugin');
    tree.root = fs.tempDir;

    createNodes = [
      '**/next.config.{js,cjs,mjs}',
      (_, { targetName }) => ({
        projects: {
          app1: {
            name: 'app1',
            targets: {
              [targetName]: { command: 'next build' },
            },
          },
          app2: {
            name: 'app2',
            targets: {
              [targetName]: { command: 'next build' },
            },
          },
        },
      }),
    ];

    await fs.createFiles({
      'app1/next.config.js': '',
      'app2/next.config.js': '',
    });
  });

  afterEach(() => {
    fs.cleanup();
  });

  describe('adding the plugin', () => {
    it('should not conflicting with the existing plugins', async () => {
      // ARRANGE
      const nxJson = readJson(tree, 'nx.json');
      nxJson.plugins ??= [];
      nxJson.plugins.push({
        plugin: '@nx/vite/plugin',
        options: { targetName: 'build' },
      });
      updateNxJson(tree, nxJson);
      fs.createFilesSync({
        'app1/vite.config.js': '',
        'app2/vite.config.js': '',
      });

      // ACT
      await addPlugin(
        tree,
        '@nx/next/plugin',
        createNodes,

        {
          targetName: ['build', 'build1'],
        },
        true
      );

      // ASSERT
      expect(
        readJson(tree, 'nx.json').plugins.find(
          (p) => p.plugin === '@nx/next/plugin'
        )
      ).toEqual({
        plugin: '@nx/next/plugin',
        options: {
          targetName: 'build1',
        },
      });
    });

    it('should not conflicting with existing project.json with executor and run-commands in plugin', async () => {
      // ARRANGE
      fs.createFilesSync({
        'app1/project.json': JSON.stringify({
          targets: { build: { executor: '@nx/next:build' } },
        }),
      });

      // ACT
      await addPlugin(
        tree,
        '@nx/next/plugin',
        createNodes,

        {
          targetName: ['build'],
        },
        true
      );

      // ASSERT
      expect(
        readJson(tree, 'nx.json').plugins.find(
          (p) => p.plugin === '@nx/next/plugin'
        )
      ).toEqual({
        plugin: '@nx/next/plugin',
        options: {
          targetName: 'build',
        },
      });
    });

    it('should not conflicting with existing project.json with executor and executor in plugin', async () => {
      // ARRANGE
      fs.createFilesSync({
        'app1/project.json': JSON.stringify({
          targets: { build: { executor: '@nx/next:build' } },
        }),
      });

      createNodes = [
        '**/next.config.{js,cjs,mjs}',
        (_, { targetName }) => ({
          projects: {
            app1: {
              name: 'app1',
              targets: {
                [targetName]: { executor: '@nx/next:build' },
              },
            },
            app2: {
              name: 'app2',
              targets: {
                [targetName]: { executor: '@nx/next:build' },
              },
            },
          },
        }),
      ];

      // ACT
      await addPlugin(
        tree,
        '@nx/next/plugin',
        createNodes,

        {
          targetName: ['build'],
        },
        true
      );

      // ASSERT
      expect(
        readJson(tree, 'nx.json').plugins.find(
          (p) => p.plugin === '@nx/next/plugin'
        )
      ).toEqual({
        plugin: '@nx/next/plugin',
        options: {
          targetName: 'build',
        },
      });
    });
  });

  it('should throw an error if no non-conflicting options are provided', async () => {
    const nxJson = readJson(tree, 'nx.json');
    nxJson.plugins ??= [];
    nxJson.plugins.push({
      plugin: '@nx/vite/plugin',
      options: { targetName: 'build' },
    });
    updateNxJson(tree, nxJson);
    fs.createFilesSync({
      'app1/vite.config.js': '',
      'app2/vite.config.js': '',
    });

    try {
      await addPlugin(
        tree,
        '@nx/next/plugin',
        createNodes,

        {
          targetName: ['build'],
        },
        true
      );
      fail('Should have thrown an error');
    } catch (e) {}
  });

  describe('updating package scripts', () => {
    test.each`
      script
      ${'next-remote-watch'}
      ${'anext build'}
      ${'next builda'}
    `('should not replace "$script"', async ({ script }) => {
      writeJson(tree, 'app1/package.json', {
        name: 'app1',
        scripts: {
          build: script,
        },
      });

      await addPlugin(
        tree,
        '@nx/next/plugin',
        createNodes,

        {
          targetName: ['build'],
        },
        true
      );

      const { scripts } = readJson<PackageJson>(tree, 'app1/package.json');
      expect(scripts.build).toBe(script);
    });

    test.each`
      script                                                                                    | expected
      ${'next build'}                                                                           | ${'nx build'}
      ${'npx next build'}                                                                       | ${'npx nx build'}
      ${'next build --debug'}                                                                   | ${'nx build --debug'}
      ${'NODE_OPTIONS="--inspect" next build'}                                                  | ${'NODE_OPTIONS="--inspect" nx build'}
      ${'NODE_OPTIONS="--inspect" npx next build --debug'}                                      | ${'NODE_OPTIONS="--inspect" npx nx build --debug'}
      ${'next build && echo "Done"'}                                                            | ${'nx build && echo "Done"'}
      ${'echo "Building..." && next build'}                                                     | ${'echo "Building..." && nx build'}
      ${'echo "Building..." && next build && echo "Done"'}                                      | ${'echo "Building..." && nx build && echo "Done"'}
      ${'echo "Building..." &&next build&& echo "Done"'}                                        | ${'echo "Building..." &&nx build&& echo "Done"'}
      ${'echo "Building..." && NODE_OPTIONS="--inspect" npx next build --debug && echo "Done"'} | ${'echo "Building..." && NODE_OPTIONS="--inspect" npx nx build --debug && echo "Done"'}
    `(
      'should replace "$script" with "$expected"',
      async ({ script, expected }) => {
        writeJson(tree, 'app1/package.json', {
          name: 'app1',
          scripts: {
            build: script,
          },
        });

        await addPlugin(
          tree,
          '@nx/next/plugin',
          createNodes,

          {
            targetName: ['build'],
          },
          true
        );

        const { scripts } = readJson<PackageJson>(tree, 'app1/package.json');
        expect(scripts.build).toBe(expected);
      }
    );

    test.each`
      script                                                                                      | expected
      ${'cypress run --e2e --config-file cypress.config.ts'}                                      | ${'nx e2e'}
      ${'echo "Starting..." && cypress run --e2e --config-file cypress.config.ts && echo "Done"'} | ${'echo "Starting..." && nx e2e && echo "Done"'}
    `(
      'should replace "$script" with "$expected"',
      async ({ script, expected }) => {
        await fs.createFile('app1/cypress.config.ts', '');
        writeJson(tree, 'app1/package.json', {
          name: 'app1',
          scripts: {
            e2e: script,
          },
        });

        createNodes = [
          '**/cypress.config.{js,ts,mjs,mts,cjs,cts}',
          () => ({
            projects: {
              app1: {
                name: 'app1',
                targets: {
                  e2e: {
                    command:
                      'cypress run --config-file cypress.config.ts --e2e',
                  },
                },
              },
            },
          }),
        ];

        await addPlugin(
          tree,
          '@nx/cypress/plugin',
          createNodes,

          {
            targetName: ['e2e'],
          },
          true
        );

        const { scripts } = readJson<PackageJson>(tree, 'app1/package.json');
        expect(scripts.e2e).toBe(expected);
      }
    );

    it('should handle scripts with name different than the target name', async () => {
      writeJson(tree, 'app1/package.json', {
        name: 'app1',
        scripts: {
          'build:dev': 'next build',
        },
      });

      await addPlugin(
        tree,
        '@nx/next/plugin',
        createNodes,

        {
          targetName: ['build'],
        },
        true
      );

      const { scripts } = readJson<PackageJson>(tree, 'app1/package.json');
      expect(scripts['build:dev']).toBe('nx build');
    });

    it('should support replacing multiple scripts', async () => {
      writeJson(tree, 'app1/package.json', {
        name: 'app1',
        scripts: {
          dev: 'PORT=4000 next dev --experimental-https',
          start: 'next build && PORT=4000 next start --experimental-https',
        },
      });

      createNodes = [
        '**/next.config.{js,cjs,mjs}',
        () => ({
          projects: {
            app1: {
              name: 'app1',
              targets: {
                build: { command: 'next build' },
                dev: { command: 'next dev' },
                start: { command: 'next start' },
              },
            },
          },
        }),
      ];

      await addPlugin(
        tree,
        '@nx/next/plugin',
        createNodes,

        {
          targetName: ['build'],
        },
        true
      );

      const { scripts } = readJson<PackageJson>(tree, 'app1/package.json');
      expect(scripts.dev).toBe('PORT=4000 nx dev --experimental-https');
      expect(scripts.start).toBe(
        'nx build && PORT=4000 nx start --experimental-https'
      );
    });

    it('should support multiple occurrences of the same command within a script', async () => {
      await fs.createFile('app1/tsconfig.json', '');
      writeJson(tree, 'app1/package.json', {
        name: 'app1',
        scripts: {
          typecheck: 'tsc -p tsconfig.lib.json && tsc -p tsconfig.spec.json',
        },
      });

      createNodes = [
        '**/tsconfig.json',
        () => ({
          projects: {
            app1: {
              name: 'app1',
              targets: {
                build: { command: 'tsc' },
              },
            },
          },
        }),
      ];

      await addPlugin(
        tree,
        '@nx/next/plugin',
        createNodes,

        {
          targetName: ['build'],
        },
        true
      );

      const { scripts } = readJson<PackageJson>(tree, 'app1/package.json');
      expect(scripts.typecheck).toBe(
        'nx build -p tsconfig.lib.json && nx build -p tsconfig.spec.json'
      );
    });

    it('should support multiple occurrences of the same command within a script with extra commands', async () => {
      await fs.createFile('app1/tsconfig.json', '');
      writeJson(tree, 'app1/package.json', {
        name: 'app1',
        scripts: {
          typecheck:
            'echo "Typechecking..." && tsc -p tsconfig.lib.json && tsc -p tsconfig.spec.json && echo "Done"',
        },
      });

      createNodes = [
        '**/tsconfig.json',
        () => ({
          projects: {
            app1: {
              name: 'app1',
              targets: {
                build: { command: 'tsc' },
              },
            },
          },
        }),
      ];

      await addPlugin(
        tree,
        '@nx/next/plugin',
        createNodes,

        {
          targetName: ['build'],
        },
        true
      );

      const { scripts } = readJson<PackageJson>(tree, 'app1/package.json');
      expect(scripts.typecheck).toBe(
        'echo "Typechecking..." && nx build -p tsconfig.lib.json && nx build -p tsconfig.spec.json && echo "Done"'
      );
    });
  });
});

describe('generateCombinations', () => {
  it('should return all combinations for a 2x2 array of strings', () => {
    const input = {
      prop1: ['1', '2'],
      prop2: ['a', 'b'],
    };
    expect(generateCombinations(input).map((v) => JSON.stringify(v)))
      .toMatchInlineSnapshot(`
      [
        "{"prop1":"1","prop2":"a"}",
        "{"prop1":"2","prop2":"a"}",
        "{"prop1":"1","prop2":"b"}",
        "{"prop1":"2","prop2":"b"}",
      ]
    `);
  });

  it('should handle arrays of 2x3 array of strings', () => {
    const input = {
      prop1: ['1', '2', '3'],
      prop2: ['a', 'b'],
    };
    expect(generateCombinations(input).map((v) => JSON.stringify(v)))
      .toMatchInlineSnapshot(`
      [
        "{"prop1":"1","prop2":"a"}",
        "{"prop1":"2","prop2":"a"}",
        "{"prop1":"3","prop2":"a"}",
        "{"prop1":"1","prop2":"b"}",
        "{"prop1":"2","prop2":"b"}",
        "{"prop1":"3","prop2":"b"}",
      ]
    `);
  });

  it('should handle arrays of 3x2 array of strings', () => {
    const input = {
      prop1: ['1', '2'],
      prop2: ['a', 'b'],
      prop3: ['i', 'ii'],
    };
    expect(generateCombinations(input).map((v) => JSON.stringify(v)))
      .toMatchInlineSnapshot(`
      [
        "{"prop1":"1","prop2":"a","prop3":"i"}",
        "{"prop1":"2","prop2":"a","prop3":"i"}",
        "{"prop1":"1","prop2":"b","prop3":"i"}",
        "{"prop1":"2","prop2":"b","prop3":"i"}",
        "{"prop1":"1","prop2":"a","prop3":"ii"}",
        "{"prop1":"2","prop2":"a","prop3":"ii"}",
        "{"prop1":"1","prop2":"b","prop3":"ii"}",
        "{"prop1":"2","prop2":"b","prop3":"ii"}",
      ]
    `);
  });

  it('should be able to be used to generate possible combinations of plugin options', () => {
    const possibleOptions = generateCombinations({
      buildTargetName: ['build', 'vite:build', 'vite-build'],
      testTargetName: ['test', 'vite:test', 'vite-test'],
      serveTargetName: ['serve', 'vite:serve', 'vite-serve'],
      previewTargetName: ['preview', 'vite:preview', 'vite-preview'],
      serveStaticTargetName: [
        'serve-static',
        'vite:serve-static',
        'vite-serve-static',
      ],
    });

    expect(possibleOptions.length).toEqual(3 ** 5);

    expect(possibleOptions[0]).toEqual({
      buildTargetName: 'build',
      previewTargetName: 'preview',
      testTargetName: 'test',
      serveTargetName: 'serve',
      serveStaticTargetName: 'serve-static',
    });
    // The first defined option is the first to be changed
    expect(possibleOptions[1]).toEqual({
      buildTargetName: 'vite:build',
      previewTargetName: 'preview',
      testTargetName: 'test',
      serveTargetName: 'serve',
      serveStaticTargetName: 'serve-static',
    });

    expect(possibleOptions[possibleOptions.length - 1]).toEqual({
      buildTargetName: 'vite-build',
      previewTargetName: 'vite-preview',
      testTargetName: 'vite-test',
      serveTargetName: 'vite-serve',
      serveStaticTargetName: 'vite-serve-static',
    });
  });
});
