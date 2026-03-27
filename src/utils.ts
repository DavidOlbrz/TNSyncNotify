export type SyncState = "RUNNING" | "SUCCESS" | "FAILED" | "ABORTED";

export interface CloudSyncJobRaw {
    id: number;
    progress: {
        percent: number;
    };
    state: SyncState;
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
    state: SyncState;
    progress: number;
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
                state: task.job.state,
                progress: task.job.progress.percent
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

export function buildTaskStatusMessage(task: EnabledSyncTask): string[] {
    const msg: string[] = [];

    switch (task.state) {
        case "RUNNING":
            msg.push(':hourglass: ');
            break;
        case "SUCCESS":
            msg.push(':white_check_mark: ');
            break;
        case "FAILED":
            msg.push(':warning: ');
            break;
        case "ABORTED":
            msg.push(':x: ');
            break;
        default:
            msg.push(':bell: ');
            break;
    }

    msg[0] += `**${task.description}**: ${task.state}`;

    if (task.state === "RUNNING") {
        msg.push(`       ${displayProgressBar(task.progress)} ${Math.round(task.progress * 100)}%`);
    }

    return msg;
}

export function displayProgressBar(progress: number): string {
    return '█'.repeat(Math.round(progress * 100 / 10)) + '░'.repeat(10 - Math.round(progress * 100 / 10));
}