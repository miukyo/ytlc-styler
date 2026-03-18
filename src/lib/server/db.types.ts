import type { KyselifyDatabase } from 'kysely-supabase';

interface SupabaseDatabase {
	public: {
		Tables: {
			overlays: {
				Row: {
					id: string;
					name: string | null;
					code: string;
					compiled_js: string;
					created_at: string;
					updated_at: string;
				};
				Insert: {
					id: string;
					name?: string | null;
					code: string;
					compiled_js: string;
					created_at: string;
					updated_at: string;
				};
				Update: {
					id?: string;
					name?: string | null;
					code?: string;
					compiled_js?: string;
					created_at?: string;
					updated_at?: string;
				};
				Relationships: [];
			};
		};
		Views: Record<string, never>;
		Functions: Record<string, never>;
		Enums: Record<string, never>;
		CompositeTypes: Record<string, never>;
	};
}

export type Database = KyselifyDatabase<SupabaseDatabase>;
