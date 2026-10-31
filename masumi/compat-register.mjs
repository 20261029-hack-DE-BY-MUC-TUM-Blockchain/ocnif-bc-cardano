import { registerHooks } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const originalSHA256 =
	"cfecfd50ae8c9445f24860d7d6f073fae9f13af4b293db7799bb6c426c8808b5";
const replacement = readFileSync(
	new URL("./personal-workspace-compat.mjs", import.meta.url),
	"utf8",
);
registerHooks({
	load(url, context, nextLoad) {
		const result = nextLoad(url, context);
		if (
			!url.endsWith(
				"/@masumi_network/sokosumi/dist/src/api/services/personal-workspace-service.js",
			)
		)
			return result;
		const actual = createHash("sha256").update(result.source).digest("hex");
		if (actual !== originalSHA256)
			throw new Error(
				"Pinned CLI1.0.4 Personal Workspace module changed; compatibility must be reviewed again",
			);
		return { ...result, source: replacement };
	},
});
