import { useQuery } from "@tanstack/react-query";
import { api, type Playbook } from "@/lib/api";

export function Playbooks() {
  const { data: playbooks, isLoading } = useQuery({
    queryKey: ["playbooks"],
    queryFn: api.getPlaybooks,
  });

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold tracking-tight">Playbooks</h1>
      <p className="text-muted-foreground">
        Reusable workflows for gym marketing and design.
      </p>

      {isLoading ? (
        <p className="mt-8 text-muted-foreground">Loading...</p>
      ) : playbooks && playbooks.length > 0 ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {playbooks.map((playbook: Playbook) => (
            <div key={playbook.uuid} className="rounded-lg border bg-card p-6">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {playbook.category ?? "General"}
              </p>
              <h3 className="mt-2 font-semibold">{playbook.name}</h3>
              {playbook.description && (
                <p className="mt-2 text-sm text-muted-foreground">{playbook.description}</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-8 rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground">No playbooks found.</p>
        </div>
      )}
    </div>
  );
}
