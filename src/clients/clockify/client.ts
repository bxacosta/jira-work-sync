// ─── Clockify Client ────────────────────────────────────

import { HttpClient } from "../http.ts";
import type { ClockifyProject, ClockifyTask, ClockifyTimeEntry, ClockifyUser, ClockifyWorkspace } from "./types.ts";

export interface TimeEntryQueryParams {
    end?: string;
    "in-progress"?: boolean;
    page?: number;
    "page-size"?: number;
    start?: string;
}

export class ClockifyClient {
    private readonly http: HttpClient;
    private readonly workspaceId: string;

    constructor(apiKey: string, workspaceId: string) {
        this.workspaceId = workspaceId;
        this.http = new HttpClient({
            baseUrl: "https://api.clockify.me/api/v1",
            headers: { "X-Api-Key": apiKey },
        });
    }

    async getCurrentUser(): Promise<ClockifyUser> {
        const res = await this.http.get<ClockifyUser>("/user");
        return res.data;
    }

    async getWorkspaces(): Promise<ClockifyWorkspace[]> {
        const res = await this.http.get<ClockifyWorkspace[]>("/workspaces");
        return res.data;
    }

    async getTimeEntries(userId: string, params?: TimeEntryQueryParams): Promise<ClockifyTimeEntry[]> {
        const queryParams: Record<string, string | number | boolean | undefined> = {};
        if (params?.start) {
            queryParams.start = params.start;
        }
        if (params?.end) {
            queryParams.end = params.end;
        }
        if (params?.["in-progress"] !== undefined) {
            queryParams["in-progress"] = params["in-progress"];
        }
        queryParams.page = params?.page ?? 1;
        queryParams["page-size"] = params?.["page-size"] ?? 50;

        const res = await this.http.get<ClockifyTimeEntry[]>(
            `/workspaces/${this.workspaceId}/user/${userId}/time-entries`,
            queryParams
        );
        return res.data;
    }

    async getTask(projectId: string, taskId: string): Promise<ClockifyTask> {
        const res = await this.http.get<ClockifyTask>(
            `/workspaces/${this.workspaceId}/projects/${projectId}/tasks/${taskId}`
        );
        return res.data;
    }

    async getProject(projectId: string): Promise<ClockifyProject> {
        const res = await this.http.get<ClockifyProject>(`/workspaces/${this.workspaceId}/projects/${projectId}`);
        return res.data;
    }
}
