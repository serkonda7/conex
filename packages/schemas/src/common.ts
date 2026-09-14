import * as v from "valibot";

export const HealthPing = v.object({
	ping: v.optional(v.literal("pong"), "pong"),
});

export type HealthPingInput = v.InferInput<typeof HealthPing>;

// Shared keyset-pagination query fields (all list routes use
// `?limit=&cursor=`; never offset). Spread into route-specific
// query objects.
export const paginationFields = {
	limit: v.optional(
		v.pipe(
			v.string(),
			v.transform((s) => Number.parseInt(s, 10)),
			v.number(),
			v.integer(),
			v.minValue(1),
			v.maxValue(100),
		),
	),
	cursor: v.optional(v.string()),
	q: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200))),
};

export const PaginationQuery = v.object(paginationFields);

export type PaginationQueryInput = v.InferInput<typeof PaginationQuery>;
export type PaginationQueryOutput = v.InferOutput<typeof PaginationQuery>;

// `/:id` path params — ids are uuid PKs everywhere.
export const IdParam = v.object({
	id: v.pipe(v.string(), v.uuid()),
});

export type IdParamOutput = v.InferOutput<typeof IdParam>;

export const Uuid = v.pipe(v.string(), v.uuid());
