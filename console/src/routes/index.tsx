import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { OmegaConsole } from "@/components/omega/console";

type Search = {
  join?: string;
};

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    join: typeof search.join === "string" ? search.join : undefined,
  }),
  component: Home,
});

function Home() {
  const { join } = Route.useSearch();
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <OmegaConsole joinKey={join} />
    </QueryClientProvider>
  );
}
