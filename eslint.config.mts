import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
				activeWindow: "readonly",
				activeDocument: "readonly",
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.js',
						'manifest.json',
						'eslint.config.mts',
					]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianmd.configs.recommended.map(config => ({
		...config,
		ignores: [...(config.ignores ?? []), 'tests/**'],
	})),
	{
		...js.configs.recommended,
		files: ['tests/**/*.mjs'],
		languageOptions: {
			globals: globals.node,
			parserOptions: { projectService: false },
		},
	},
	globalIgnores([
		".worktrees/**",
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"main.js",
	]),
);
