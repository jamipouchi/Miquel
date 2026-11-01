export function escapeHtml(text: string): string {
    const map: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
    }
    return text.replace(/[&<>"']/g, (m) => map[m])
}

export function sanitizeComment(
    name: string,
    message: string
): { valid: boolean; error?: string; name?: string; message?: string } {
    const trimmedName = name.trim()
    const trimmedMessage = message.trim()

    if (!trimmedName) {
        return { valid: false, error: 'Name is required' }
    }
    if (trimmedName.length > 50) {
        return { valid: false, error: 'Name must be 50 characters or less' }
    }

    if (!trimmedMessage) {
        return { valid: false, error: 'Message is required' }
    }
    if (trimmedMessage.length > 500) {
        return { valid: false, error: 'Message must be 500 characters or less' }
    }

    const safeName = escapeHtml(trimmedName)
    const safeMessage = escapeHtml(trimmedMessage)

    return { valid: true, name: safeName, message: safeMessage }
}

export type Comment_v1 = {
    name: string
    message: string
    created_at: string
    comments: Comment_v1[]
}

export function insertCommentAtPath(
    comments: Comment_v1[],
    parentPath: number[],
    newComment: Comment_v1
): Comment_v1[] {
    if (parentPath.length === 0) {
        comments.push(newComment)
        return comments
    }

    const [first, ...rest] = parentPath

    if (first >= comments.length) {
        throw new Error('Invalid parent path: index out of bounds')
    }

    if (rest.length === 0) {
        if (!comments[first].comments) {
            comments[first].comments = []
        }
        comments[first].comments.push(newComment)
    } else {
        if (!comments[first].comments) {
            throw new Error('Invalid parent path: no nested comments at this index')
        }
        comments[first].comments = insertCommentAtPath(comments[first].comments, rest, newComment)
    }

    return comments
}
