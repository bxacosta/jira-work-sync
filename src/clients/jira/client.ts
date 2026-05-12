// ─── Jira Client ────────────────────────────────────────

const TRAILING_SLASH_RE = /\/$/;

import { JIRA_PROPERTY_KEY } from "../../constants.ts";
import { HttpClient, HttpClientError } from "../http.ts";
import type {
    CreateWorklogPayload,
    JiraAdfDocument,
    JiraIssue,
    JiraUser,
    JiraWorklog,
    JiraWorklogListResponse,
    WSyncPropertyValue,
} from "./types.ts";

export class JiraClient {
    private readonly http: HttpClient;

    constructor(baseUrl: string, email: string, apiToken: string) {
        const credentials = Buffer.from(`${email}:${apiToken}`).toString("base64");
        this.http = new HttpClient({
            baseUrl: `${baseUrl.replace(TRAILING_SLASH_RE, "")}/rest/api/3`,
            headers: { Authorization: `Basic ${credentials}` },
        });
    }

    async getMyself(): Promise<JiraUser> {
        const res = await this.http.get<JiraUser>("/myself");
        return res.data;
    }

    async getIssue(issueKey: string): Promise<JiraIssue | null> {
        try {
            const res = await this.http.get<JiraIssue>(`/issue/${issueKey}`, { fields: "summary,status,project" });
            return res.data;
        } catch (err) {
            if (err instanceof HttpClientError && err.status === 404) {
                return null;
            }
            throw err;
        }
    }

    async addWorklog(issueKey: string, payload: CreateWorklogPayload): Promise<JiraWorklog> {
        const res = await this.http.post<JiraWorklog>(`/issue/${issueKey}/worklog`, payload);
        return res.data;
    }

    async getWorklogs(issueKey: string, startedAfterMs?: number): Promise<JiraWorklog[]> {
        const params: Record<string, string | number | boolean | undefined> = {};
        if (startedAfterMs) {
            params.startedAfter = startedAfterMs;
        }

        const res = await this.http.get<JiraWorklogListResponse>(`/issue/${issueKey}/worklog`, params);
        return res.data.worklogs;
    }

    async getWorklogProperty(issueKey: string, worklogId: string): Promise<WSyncPropertyValue | null> {
        try {
            const res = await this.http.get<{ key: string; value: WSyncPropertyValue }>(
                `/issue/${issueKey}/worklog/${worklogId}/properties/${JIRA_PROPERTY_KEY}`
            );
            return res.data.value;
        } catch (err) {
            if (err instanceof HttpClientError && err.status === 404) {
                return null;
            }
            throw err;
        }
    }

    /** Build an ADF comment document */
    static buildAdfComment(text: string): JiraAdfDocument {
        return {
            type: "doc",
            version: 1,
            content: [
                {
                    type: "paragraph",
                    content: [{ type: "text", text }],
                },
            ],
        };
    }

    /** Build worklog properties with our clockify entry ID */
    static buildWorklogProperties(clockifyEntryId: string, source: string) {
        return [
            {
                key: JIRA_PROPERTY_KEY,
                value: {
                    clockifyEntryId,
                    syncedAt: new Date().toISOString(),
                    source,
                } satisfies WSyncPropertyValue,
            },
        ];
    }
}
