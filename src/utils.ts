export interface CloudSyncJobRaw {
    id: number;
    progress: unknown;
    state: string;
}

export interface CloudSyncTaskRaw {
    id: number;
    description: string;
    enabled: boolean;
    job: CloudSyncJobRaw | null;
}

export interface EnabledSyncTask {
    id: number;
    description: string;
    job: CloudSyncJobRaw;
}

type EnabledTaskWithJob = CloudSyncTaskRaw & {
    enabled: true;
    job: CloudSyncJobRaw;
};

export function getEnabledSyncTasks(tasks: CloudSyncTaskRaw[]): EnabledSyncTask[] {
    return tasks
        .filter((task): task is EnabledTaskWithJob => task.enabled && task.job !== null)
        .map((task) => {
            return {
                id: task.id,
                description: task.description,
                job: task.job
            };
        });
}

export async function sendDiscordNotification(webhookUrl: string, content: string): Promise<void> {
    if (!content.trim()) {
        return;
    }

    const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ content })
    });

    const text = await response.text();
    console.log(response.status, text);
}
