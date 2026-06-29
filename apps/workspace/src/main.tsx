import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { BrowserRouter } from "react-router";
import App from "./App";
import "./index.css";
import { WorkspaceProvider } from "./lib/workspace";
import { api } from "./lib/api";
import { ConditionalClerkProvider } from "./components/ConditionalClerkProvider";

const queryClient = new QueryClient();
const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as
  | string
  | undefined;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConditionalClerkProvider publishableKey={publishableKey}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <WorkspaceProvider fetchWorkspaces={api.getWorkspaces}>
            <App />
          </WorkspaceProvider>
        </BrowserRouter>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </ConditionalClerkProvider>
  </StrictMode>,
);
