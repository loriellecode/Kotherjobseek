const no = () => { throw new Error('not available in the phone edition'); };
export const createServer = no, request = no, Agent = function () {}, lookup = no, promises = { lookup: no }, isIP = (s) => (/^\d+\.\d+\.\d+\.\d+$/.test(s) ? 4 : s.includes(':') ? 6 : 0), isIPv4 = (s) => isIP(s) === 4, isIPv6 = (s) => isIP(s) === 6;
export const setVapidDetails = () => {}, sendNotification = no, generateVAPIDKeys = no;
export default { createServer, request, promises, isIP, isIPv4, isIPv6, setVapidDetails, sendNotification };
