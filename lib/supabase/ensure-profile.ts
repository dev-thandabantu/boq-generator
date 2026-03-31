import type { SupabaseClient, User } from "@supabase/supabase-js";

export async function ensureProfileExists(
  serviceClient: SupabaseClient,
  user: User
) {
  const metadata = user.user_metadata ?? {};

  const { error } = await serviceClient
    .from("profiles")
    .upsert(
      {
        id: user.id,
        email: user.email ?? null,
        full_name:
          typeof metadata.full_name === "string"
            ? metadata.full_name
            : typeof metadata.name === "string"
              ? metadata.name
              : null,
        avatar_url:
          typeof metadata.avatar_url === "string" ? metadata.avatar_url : null,
      },
      { onConflict: "id", ignoreDuplicates: false }
    );

  return { error };
}
