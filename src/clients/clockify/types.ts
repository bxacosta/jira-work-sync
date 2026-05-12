// ─── Clockify Types ─────────────────────────────────────

export interface ClockifyUser {
    activeWorkspace: string;
    defaultWorkspace: string;
    email: string;
    id: string;
    name: string;
    status: string;
}

export interface ClockifyWorkspace {
    id: string;
    name: string;
}

export interface ClockifyTimeInterval {
    duration: string | null;
    end: string | null;
    start: string;
}

export interface ClockifyTimeEntry {
    billable: boolean;
    description: string;
    id: string;
    isLocked: boolean;
    projectId: string | null;
    tagIds: string[];
    taskId: string | null;
    timeInterval: ClockifyTimeInterval;
    userId: string;
    workspaceId: string;
}

export interface ClockifyTask {
    id: string;
    name: string;
    projectId: string;
    status: string;
}

export interface ClockifyProject {
    id: string;
    name: string;
    workspaceId: string;
}
