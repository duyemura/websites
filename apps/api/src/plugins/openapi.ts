import fp from "fastify-plugin";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

export default fp(
  (fastify, _, done) => {
    void fastify.register(swagger, {
      openapi: {
        info: {
          title: "Milo for gyms API",
          description: "AI website builder for gyms and fitness studios",
          version: "0.0.1",
        },
      },
    });
    void fastify.register(swaggerUi, {
      routePrefix: "/docs",
    });
    done();
  },
  { name: "openapi", dependencies: ["env"] },
);
