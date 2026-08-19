// SPDX-License-Identifier: Apache-2.0
// Minimal chrome extension API mock for Jest. Individual tests override specific methods as needed.
function makeAutoMock(): any {
    return new Proxy({}, {
        get: (target: any, prop: string) => {
            if (!(prop in target)) {
                target[prop] = jest.fn();
            }
            return target[prop];
        }
    });
}

(global as any).chrome = {
    bookmarks: makeAutoMock(),
    storage: {
        local: makeAutoMock(),
        sync: makeAutoMock()
    },
    tabs: makeAutoMock(),
    runtime: makeAutoMock()
};
