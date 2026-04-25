import { readFileSync } from 'node:fs';

const read = (relativePath) =>
	readFileSync(new URL(relativePath, import.meta.url), 'utf8');

const packageJson = JSON.parse(read('../package.json'));
const moduleBazel = read('../MODULE.bazel');
const buildBazel = read('../BUILD.bazel');
const ciWorkflow = read('../.github/workflows/ci.yml');
const publishWorkflow = read('../.github/workflows/publish.yml');

const extract = (source, pattern, label) => {
	const match = source.match(pattern);
	if (!match?.[1]) {
		throw new Error(`Unable to find ${label}`);
	}
	return match[1];
};

const expectedVersion = packageJson.version;
const expectedPackageName = packageJson.name;
const expectedPnpmVersion = packageJson.packageManager?.replace(/^pnpm@/, '');
const expectedRepositoryUrl = 'git+https://github.com/Jesssullivan/scheduling-kit.git';
const expectedPackageBasename = expectedPackageName.split('/').at(-1);
const expectedRepositoryOwner = new URL(expectedRepositoryUrl.replace(/^git\+/, ''))
	.pathname.split('/')
	.filter(Boolean)[0]
	.toLowerCase();
const expectedGitHubPackageName = `@${expectedRepositoryOwner}/${expectedPackageBasename}`;

const includes = (source, needle) => source.includes(needle);
const scalar = (value) =>
	value
		.trim()
		.replace(/^(['"])(.*)\1\s*(?:#.*)?$/, '$2')
		.replace(/\s+#.*$/, '')
		.trim();
const usesPinnedPackageWorkflow = (workflow) =>
	/uses:\s*tinyland-inc\/ci-templates\/\.github\/workflows\/js-bazel-package\.yml@[0-9a-fA-F]{40}/.test(
		workflow,
	);

const checks = [
	{
		label: 'MODULE.bazel version',
		actual: extract(moduleBazel, /module\([\s\S]*?version = "([^"]+)"/m, 'module version'),
		expected: expectedVersion,
	},
	{
		label: 'BUILD.bazel npm_package version',
		actual: extract(buildBazel, /npm_package\([\s\S]*?version = "([^"]+)"/m, 'npm_package version'),
		expected: expectedVersion,
	},
	{
		label: 'BUILD.bazel npm_package name',
		actual: extract(buildBazel, /npm_package\([\s\S]*?package = "([^"]+)"/m, 'npm_package name'),
		expected: expectedPackageName,
	},
	{
		label: 'MODULE.bazel pnpm version',
		actual: extract(moduleBazel, /pnpm_version = "([^"]+)"/, 'pnpm_version'),
		expected: expectedPnpmVersion,
	},
	{
		label: 'package.json repository',
		actual: packageJson.repository?.url,
		expected: expectedRepositoryUrl,
	},
	{
		label: 'CI reusable workflow pin',
		actual: String(usesPinnedPackageWorkflow(ciWorkflow)),
		expected: 'true',
	},
	{
		label: 'CI runner mode',
		actual: scalar(extract(ciWorkflow, /runner_mode:\s*([^\n]+)/, 'CI runner_mode')),
		expected: 'shared',
	},
	{
		label: 'CI publish mode',
		actual: scalar(extract(ciWorkflow, /publish_mode:\s*([^\n]+)/, 'CI publish_mode')),
		expected: 'same_runner',
	},
	{
		label: 'CI package artifact path',
		actual: scalar(extract(ciWorkflow, /package_dir:\s*([^\n]+)/, 'CI package_dir')),
		expected: './bazel-bin/pkg',
	},
	{
		label: 'CI Bazel package target',
		actual: String(
			includes(extract(ciWorkflow, /bazel_targets:\s*"([^"]+)"/, 'CI bazel_targets'), '//:pkg'),
		),
		expected: 'true',
	},
	{
		label: 'CI GitHub Packages name',
		actual: extract(ciWorkflow, /github_package_name:\s*"([^"]+)"/, 'CI github_package_name'),
		expected: expectedGitHubPackageName,
	},
	{
		label: 'publish reusable workflow pin',
		actual: String(usesPinnedPackageWorkflow(publishWorkflow)),
		expected: 'true',
	},
	{
		label: 'publish packages permission',
		actual: scalar(
			extract(publishWorkflow, /packages:\s*([^\n]+)/, 'publish packages permission'),
		),
		expected: 'write',
	},
	{
		label: 'publish package artifact path',
		actual: scalar(extract(publishWorkflow, /package_dir:\s*([^\n]+)/, 'publish package_dir')),
		expected: './bazel-bin/pkg',
	},
	{
		label: 'publish Bazel package target',
		actual: String(
			includes(
				extract(publishWorkflow, /bazel_targets:\s*"([^"]+)"/, 'publish bazel_targets'),
				'//:pkg',
			),
		),
		expected: 'true',
	},
	{
		label: 'publish GitHub Packages name',
		actual: extract(publishWorkflow, /github_package_name:\s*"([^"]+)"/, 'publish github_package_name'),
		expected: expectedGitHubPackageName,
	},
];

const failures = checks.filter((check) => check.actual !== check.expected);

if (failures.length > 0) {
	for (const failure of failures) {
		console.error(
			`${failure.label} mismatch: expected "${failure.expected}", found "${failure.actual}"`,
		);
	}
	process.exit(1);
}

console.log(
	`release metadata aligned for ${expectedPackageName}@${expectedVersion} (pnpm ${expectedPnpmVersion}, ${expectedGitHubPackageName})`,
);
