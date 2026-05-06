import { createClient } from "@supabase/supabase-js";

export interface ResultsBroadcaster {
  publishRefresh(positionId: string): Promise<void>;
}

export class NoopResultsBroadcaster implements ResultsBroadcaster {
  public async publishRefresh(_positionId: string) {
    return;
  }
}

export class SupabaseResultsBroadcaster implements ResultsBroadcaster {
  private readonly client;

  public constructor(
    private readonly supabaseUrl: string,
    private readonly serviceRoleKey: string
  ) {
    this.client = createClient(this.supabaseUrl, this.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }

  public async publishRefresh(positionId: string) {
    const channel = this.client.channel("results");

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out subscribing to results channel")), 5_000);

      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve();
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timeout);
          reject(new Error(`Unable to subscribe to realtime channel: ${status}`));
        }
      });
    });

    try {
      await channel.send({
        type: "broadcast",
        event: "results.refresh",
        payload: {
          positionId,
          refreshedAt: new Date().toISOString()
        }
      });
    } finally {
      await this.client.removeChannel(channel);
    }
  }
}
