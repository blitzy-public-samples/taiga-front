/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * User-story attachment API functions hitting the FROZEN Django
 * `/api/v1/userstories/attachments` endpoint (nav-url key `attachments/us`,
 * `app/coffee/modules/resources.coffee` L160). No backend change is introduced;
 * this is a like-for-like port of the AngularJS attachments resource
 * (`app/modules/resources/attachments-resource.service.coffee` L116-133) and the
 * generic-form `createAttachments` / `deleteAttachments` flows
 * (`app/coffee/modules/common/lightboxes.coffee` L719-728).
 *
 * [M-10] The migrated create/edit lightboxes reproduce the legacy
 * attachment-add / attachment-delete behavior through these functions:
 *  - CREATE defers upload until the story exists (the endpoint needs `object_id`),
 *  - EDIT uploads immediately and deletes any removed existing attachments.
 */

import { httpDelete, httpGet, httpPost } from "./httpClient";
import type { HttpResponse } from "./httpClient";

/** Minimal structural attachment shape returned by the endpoint. */
export interface UserStoryAttachment {
    id: number;
    /** Original file name (`name` in the serializer). */
    name: string;
    /** Download URL of the stored file. */
    url?: string;
    [key: string]: unknown;
}

/**
 * `POST /userstories/attachments` (multipart) — attach a file to a user story.
 *
 * Mirrors the legacy FormData payload verbatim: `project`, `object_id`,
 * `attached_file`, `from_comment` (`attachments-resource.service.coffee`
 * L116-120). The browser sets the `multipart/form-data` boundary; the shared
 * httpClient omits the JSON `Content-Type` for `FormData` bodies.
 */
export function uploadUserstoryAttachment(
    file: File,
    objectId: number,
    projectId: number,
    fromComment = false,
): Promise<HttpResponse<UserStoryAttachment>> {
    const data = new FormData();
    // Order and field names match the AngularJS resource exactly.
    data.append("project", String(projectId));
    data.append("object_id", String(objectId));
    data.append("attached_file", file);
    data.append("from_comment", String(fromComment));

    return httpPost<UserStoryAttachment>("/userstories/attachments", data);
}

/**
 * `DELETE /userstories/attachments/{id}` — remove an existing attachment
 * (mirrors `AttachmentsService.delete` → `rs.attachments.delete(type, id)`).
 */
export function deleteUserstoryAttachment(
    attachmentId: number,
): Promise<HttpResponse<void>> {
    return httpDelete<void>(`/userstories/attachments/${attachmentId}`);
}

/**
 * `GET /userstories/attachments?object_id={id}&project={pid}` — list the
 * attachments of a user story. Used to seed the edit form when the story model
 * was fetched without `include_attachments` (mirrors the legacy
 * `include_attachments: true` list param on the generic-form schema,
 * `lightboxes.coffee` L544).
 */
export function listUserstoryAttachments(
    objectId: number,
    projectId: number,
): Promise<HttpResponse<UserStoryAttachment[]>> {
    return httpGet<UserStoryAttachment[]>("/userstories/attachments", {
        object_id: objectId,
        project: projectId,
    });
}
