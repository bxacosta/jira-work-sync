// ─── Jira Types ─────────────────────────────────────────

export interface JiraUser {
    accountId: string;
    displayName: string;
    emailAddress: string;
}

export interface JiraIssue {
    fields: {
        summary: string;
        status: { name: string };
        project: { key: string; name: string };
    };
    id: string;
    key: string;
}

export interface JiraWorklog {
    author: {
        accountId: string;
        displayName: string;
    };
    comment?: unknown;
    id: string;
    properties?: JiraWorklogProperty[];
    started: string;
    timeSpentSeconds: number;
}

export interface JiraWorklogProperty {
    key: string;
    value: unknown;
}

export interface JiraWorklogListResponse {
    maxResults: number;
    startAt: number;
    total: number;
    worklogs: JiraWorklog[];
}

/** Payload for creating a worklog */
export interface CreateWorklogPayload {
    comment?: JiraAdfDocument;
    properties?: JiraWorklogProperty[];
    started: string;
    timeSpentSeconds: number;
}

/** Atlassian Document Format (ADF) types for comments */
export interface JiraAdfDocument {
    content: JiraAdfBlock[];
    type: "doc";
    version: 1;
}

export interface JiraAdfBlock {
    content: JiraAdfInline[];
    type: "paragraph";
}

export interface JiraAdfInline {
    text: string;
    type: "text";
}

/** Our custom property value stored on worklogs */
export interface WSyncPropertyValue {
    clockifyEntryId: string;
    source: string;
    syncedAt: string;
}
