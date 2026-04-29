

Use case: infographic-diagram
Asset type: PR review grounding diagram

Primary request:
Use ImageGen skill to generate this and not a SVG.
Create a developer-focused, high-level diagram for PR #{PR_NUMBER}: {PR_TITLE}.
Visualize one main change from the PR, not the whole diff:
{ONE_MAIN_CHANGE}

Scene/backdrop:
Clean technical review diagram on a light neutral background.

Subject:
A concrete flow grounded in the PR’s actual behavior change.

Style/medium:
Polished engineering infographic, simple boxes, thin arrows, minimal icons, legible labels, restrained detail.

Composition/framing:
Landscape 16:9. Use a left-to-right flow with two visually distinct zones:
1. "{LEFT_ZONE_NAME}"
2. "{RIGHT_ZONE_NAME}"

Show 3 compact source/input boxes feeding into the main changed artifact:
- "{INPUT_1}"
- "{INPUT_2}"
- "{INPUT_3}"

Then show the transformation step:
- "{TRANSFORMATION_LABEL}"

Then show the resulting artifact/state:
- "{OUTPUT_LABEL}"

Add 1 small concrete example under the most important input:
"Example: {CONCRETE_EXAMPLE}"

Add small ownership labels:
- "{LEFT_OWNER_LABEL}"
- "{RIGHT_OWNER_LABEL}"

Add one dashed boundary label:
"{BOUNDARY_INVARIANT}"

Add one small annotation near the transformation:
"{KEY_REVIEW_INVARIANT}"

Text (verbatim):
"{TITLE}"
"{LEFT_ZONE_NAME}"
"{RIGHT_ZONE_NAME}"
"{INPUT_1}"
"{INPUT_2}"
"{INPUT_3}"
"Example: {CONCRETE_EXAMPLE}"
"{TRANSFORMATION_LABEL}"
"{OUTPUT_LABEL}"
"{LEFT_OWNER_LABEL}"
"{RIGHT_OWNER_LABEL}"
"{BOUNDARY_INVARIANT}"
"{KEY_REVIEW_INVARIANT}"

Constraints:
Keep it useful to a developer reviewing the PR.
Maximum 8 main boxes total.
Make secondary annotations visibly smaller than main flow labels.
Text must be spelled exactly and remain readable.
Do not include commit hashes, file lists, dense schemas, excessive implementation classes, or decorative filler.

Color palette:
Off-white background, charcoal text, muted blue for live/runtime/source inputs, muted green for captured/intermediate artifacts, muted amber for transformation/output, light gray arrows and dashed boundary.

Avoid:
Generic architecture poster, marketing style, tiny unreadable text, crowded flowchart, stock imagery, logos, watermark.
