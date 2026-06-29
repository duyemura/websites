import { ClerkProvider, useAuth } from "@clerk/react";
import { setAuthTokenGetter } from "@/lib/api";
import { useEffect, type ReactNode } from "react";

function AuthInitializer({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();

  useEffect(() => {
    setAuthTokenGetter(() => getToken());
  }, [getToken]);

  return <>{children}</>;
}

export function ConditionalClerkProvider({
  publishableKey,
  children,
}: {
  publishableKey: string | undefined;
  children: ReactNode;
}) {
  if (!publishableKey) {
    return <>{children}</>;
  }

  return (
    <ClerkProvider publishableKey={publishableKey}>
      <AuthInitializer>{children}</AuthInitializer>
    </ClerkProvider>
  );
}
