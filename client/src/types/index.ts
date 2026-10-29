export interface TimeEntry {
  id: number;
  description: string;
  start_time: string;
  end_time: string | null;
  duration: number | null;
  synced: 0 | 1;
  sync_error: string | null;
  synced_at: string | null;
  created_at: string;
}

export interface Settings {
  user_email?: string;
  jira_base_url?: string;
  jira_token?: string;
  clockify_api_key?: string;
}

export interface JiraIssue {
  id: string;
  key: string;
  mine: boolean;
  fields: {
    summary: string;
    status: { name: string };
    assignee: { displayName: string; emailAddress: string } | null;
    issuetype: { name: string; iconUrl: string };
    priority: { name: string } | null;
    project: { key: string; name: string };
    parent?: { key: string; fields: { summary: string; issuetype: { name: string } } };
    updated?: string;
    timespent?: number | null;
    aggregatetimespent?: number | null;
    timeoriginalestimate?: number | null;
    aggregatetimeoriginalestimate?: number | null;
  };
}
