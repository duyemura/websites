import fp from "fastify-plugin";
import cors from "@fastify/cors";

export default fp(
  (fastify, _, done) => {
    void fastify.register(cors, {
      origin: true,
      credentials: true,
    });
    done();
  },
  { name: "cors", dependencies: ["env"] },
);
