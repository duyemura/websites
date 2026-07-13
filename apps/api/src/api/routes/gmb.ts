import { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";
import { getPlaceDetails, searchPlaces } from "@milo/gmb-client";

const SearchQuerySchema = z.object({
  q: z.string().min(1),
  languageCode: z.string().optional(),
  regionCode: z.string().optional(),
  pageSize: z.coerce.number().min(1).max(20).optional(),
});

const PlaceIdSchema = z.object({
  placeId: z.string().min(1),
});

const GmbListingSchema = z.object({
  placeId: z.string(),
  name: z.string(),
  primaryType: z.string().optional(),
  types: z.array(z.string()),
  address: z.object({
    streetNumber: z.string().optional(),
    streetName: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    postalCode: z.string().optional(),
    fullAddress: z.string().optional(),
  }),
  phoneNumber: z.string().optional(),
  websiteUri: z.string().optional(),
  googleMapsUri: z.string().optional(),
  rating: z.number().optional(),
  userRatingCount: z.number().optional(),
  priceLevel: z.string().optional(),
  editorialSummary: z.string().optional(),
  regularOpeningHours: z
    .array(
      z.object({
        day: z.string(),
        open: z.string().optional(),
        close: z.string().optional(),
        isOpen24Hours: z.boolean().optional(),
        isClosed: z.boolean().optional(),
      }),
    )
    .optional(),
  photos: z.array(
    z.object({
      name: z.string(),
      url: z.string(),
      heightPx: z.number().optional(),
      widthPx: z.number().optional(),
      authorAttributions: z
        .array(
          z.object({
            displayName: z.string().optional(),
            uri: z.string().optional(),
          }),
        )
        .optional(),
    }),
  ),
  reviews: z.array(
    z.object({
      name: z.string(),
      rating: z.number(),
      text: z.string().optional(),
      publishTime: z.string().optional(),
      author: z.string().optional(),
    }),
  ),
  businessStatus: z.string().optional(),
  isOpen: z.boolean().optional(),
  utcOffsetMinutes: z.number().optional(),
  iconMaskBaseUri: z.string().optional(),
  iconBackgroundColor: z.string().optional(),
});

const app: FastifyPluginCallbackZodOpenApi = (fastify, _, done) => {
  fastify.get(
    "/gmb/search",
    {
      schema: {
        querystring: SearchQuerySchema,
        response: {
          200: z.object({
            places: z.array(GmbListingSchema),
            nextPageToken: z.string().optional(),
          }),
          400: z.object({ error: z.string() }),
          500: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const apiKey = fastify.config.GOOGLE_PLACES_API_KEY;
      if (!apiKey) {
        return reply.code(500).send({ error: "Google Places API key is not configured" });
      }

      try {
        const result = await searchPlaces(request.query.q, apiKey, {
          languageCode: request.query.languageCode,
          regionCode: request.query.regionCode,
          pageSize: request.query.pageSize,
        });
        return { places: result.places, nextPageToken: result.nextPageToken };
      } catch (err) {
        fastify.log.error(err);
        const message = err instanceof Error ? err.message : "Failed to search Google Places";
        return reply.code(500).send({ error: message });
      }
    },
  );

  fastify.get(
    "/gmb/places/:placeId",
    {
      schema: {
        params: PlaceIdSchema,
        response: {
          200: GmbListingSchema,
          400: z.object({ error: z.string() }),
          500: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const apiKey = fastify.config.GOOGLE_PLACES_API_KEY;
      if (!apiKey) {
        return reply.code(500).send({ error: "Google Places API key is not configured" });
      }

      try {
        const place = await getPlaceDetails(request.params.placeId, apiKey);
        return place;
      } catch (err) {
        fastify.log.error(err);
        const message = err instanceof Error ? err.message : "Failed to fetch Google Place details";
        return reply.code(500).send({ error: message });
      }
    },
  );

  done();
};

export default app;
