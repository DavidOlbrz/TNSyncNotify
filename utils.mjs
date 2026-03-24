export function getEnabledSyncTasks(tasks) {
    return tasks.filter(task => task.enabled).map(task => {
        return {
            id: task.id,
            description: task.description,
            job: {
                id: task.job.id,
                progress: task.job.progress,
                state: task.job.state
            }
        }
    });
}

export async function sendDiscordNotification(webhookUrl, content) {
    console.log("URL: ", webhookUrl);

    const params = {
        content: content
    }

    return fetch(webhookUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(params)
    }).then(async response => {
        const text = await response.text();
        console.log(response.status, text);
    });
}