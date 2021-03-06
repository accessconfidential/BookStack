"use strict";

const moment = require('moment');
require('moment/locale/en-gb');
const editorOptions = require("./pages/page-form");

moment.locale('en-gb');

module.exports = function (ngApp, events) {


    ngApp.controller('PageEditController', ['$scope', '$http', '$attrs', '$interval', '$timeout', '$sce',
        function ($scope, $http, $attrs, $interval, $timeout, $sce) {

        $scope.editorOptions = editorOptions();
        $scope.editContent = '';
        $scope.draftText = '';
        let pageId = Number($attrs.pageId);
        let isEdit = pageId !== 0;
        let autosaveFrequency = 30; // AutoSave interval in seconds.
        let isMarkdown = $attrs.editorType === 'markdown';
        $scope.draftsEnabled = $attrs.draftsEnabled === 'true';
        $scope.isUpdateDraft = Number($attrs.pageUpdateDraft) === 1;
        $scope.isNewPageDraft = Number($attrs.pageNewDraft) === 1;

        // Set initial header draft text
        if ($scope.isUpdateDraft || $scope.isNewPageDraft) {
            $scope.draftText = trans('entities.pages_editing_draft');
        } else {
            $scope.draftText = trans('entities.pages_editing_page');
        }

        let autoSave = false;

        let currentContent = {
            title: false,
            html: false
        };

        if (isEdit && $scope.draftsEnabled) {
            setTimeout(() => {
                startAutoSave();
            }, 1000);
        }

        // Actions specifically for the markdown editor
        if (isMarkdown) {
            $scope.displayContent = '';
            // Editor change event
            $scope.editorChange = function (content) {
                $scope.displayContent = $sce.trustAsHtml(content);
            }
        }

        if (!isMarkdown) {
            $scope.editorChange = function() {};
        }

        let lastSave = 0;

        /**
         * Start the AutoSave loop, Checks for content change
         * before performing the costly AJAX request.
         */
        function startAutoSave() {
            currentContent.title = $('#name').val();
            currentContent.html = $scope.editContent;

            autoSave = $interval(() => {
                // Return if manually saved recently to prevent bombarding the server
                if (Date.now() - lastSave < (1000*autosaveFrequency)/2) return;
                let newTitle = $('#name').val();
                let newHtml = $scope.editContent;

                if (newTitle !== currentContent.title || newHtml !== currentContent.html) {
                    currentContent.html = newHtml;
                    currentContent.title = newTitle;
                    saveDraft();
                }

            }, 1000 * autosaveFrequency);
        }

        let draftErroring = false;
        /**
         * Save a draft update into the system via an AJAX request.
         */
        function saveDraft() {
            if (!$scope.draftsEnabled) return;
            let data = {
                name: $('#name').val(),
                html: isMarkdown ? $sce.getTrustedHtml($scope.displayContent) : $scope.editContent
            };

            if (isMarkdown) data.markdown = $scope.editContent;

            let url = window.baseUrl('/ajax/page/' + pageId + '/save-draft');
            $http.put(url, data).then(responseData => {
                draftErroring = false;
                let updateTime = moment.utc(moment.unix(responseData.data.timestamp)).toDate();
                $scope.draftText = responseData.data.message + moment(updateTime).format('HH:mm');
                if (!$scope.isNewPageDraft) $scope.isUpdateDraft = true;
                showDraftSaveNotification();
                lastSave = Date.now();
            }, errorRes => {
                if (draftErroring) return;
                events.emit('error', trans('errors.page_draft_autosave_fail'));
                draftErroring = true;
            });
        }

        function showDraftSaveNotification() {
            $scope.draftUpdated = true;
            $timeout(() => {
                $scope.draftUpdated = false;
            }, 2000)
        }

        $scope.forceDraftSave = function() {
            saveDraft();
        };

        // Listen to save draft events from editor
        $scope.$on('save-draft', saveDraft);

        /**
         * Discard the current draft and grab the current page
         * content from the system via an AJAX request.
         */
        $scope.discardDraft = function () {
            let url = window.baseUrl('/ajax/page/' + pageId);
            $http.get(url).then(responseData => {
                if (autoSave) $interval.cancel(autoSave);
                $scope.draftText = trans('entities.pages_editing_page');
                $scope.isUpdateDraft = false;
                $scope.$broadcast('html-update', responseData.data.html);
                $scope.$broadcast('markdown-update', responseData.data.markdown || responseData.data.html);
                $('#name').val(responseData.data.name);
                $timeout(() => {
                    startAutoSave();
                }, 1000);
                events.emit('success', trans('entities.pages_draft_discarded'));
            });
        };

    }]);

    ngApp.controller('PageAttachmentController', ['$scope', '$http', '$attrs',
        function ($scope, $http, $attrs) {

            const pageId = $scope.uploadedTo = $attrs.pageId;
            let currentOrder = '';
            $scope.files = [];
            $scope.editFile = false;
            $scope.file = getCleanFile();
            $scope.errors = {
                link: {},
                edit: {}
            };

            function getCleanFile() {
                return {
                    page_id: pageId
                };
            }

            // Angular-UI-Sort options
            $scope.sortOptions = {
                handle: '.handle',
                items: '> tr',
                containment: "parent",
                axis: "y",
                stop: sortUpdate,
            };

            /**
             * Event listener for sort changes.
             * Updates the file ordering on the server.
             * @param event
             * @param ui
             */
            function sortUpdate(event, ui) {
                let newOrder = $scope.files.map(file => {return file.id}).join(':');
                if (newOrder === currentOrder) return;

                currentOrder = newOrder;
                $http.put(window.baseUrl(`/attachments/sort/page/${pageId}`), {files: $scope.files}).then(resp => {
                    events.emit('success', resp.data.message);
                }, checkError('sort'));
            }

            /**
             * Used by dropzone to get the endpoint to upload to.
             * @returns {string}
             */
            $scope.getUploadUrl = function (file) {
                let suffix = (typeof file !== 'undefined') ? `/${file.id}` : '';
                return window.baseUrl(`/attachments/upload${suffix}`);
            };

            /**
             * Get files for the current page from the server.
             */
            function getFiles() {
                let url = window.baseUrl(`/attachments/get/page/${pageId}`);
                $http.get(url).then(resp => {
                    $scope.files = resp.data;
                    currentOrder = resp.data.map(file => {return file.id}).join(':');
                }, checkError('get'));
            }
            getFiles();

            /**
             * Runs on file upload, Adds an file to local file list
             * and shows a success message to the user.
             * @param file
             * @param data
             */
            $scope.uploadSuccess = function (file, data) {
                $scope.$apply(() => {
                    $scope.files.push(data);
                });
                events.emit('success', trans('entities.attachments_file_uploaded'));
            };

            /**
             * Upload and overwrite an existing file.
             * @param file
             * @param data
             */
            $scope.uploadSuccessUpdate = function (file, data) {
                $scope.$apply(() => {
                    let search = filesIndexOf(data);
                    if (search !== -1) $scope.files[search] = data;

                    if ($scope.editFile) {
                        $scope.editFile = angular.copy(data);
                        data.link = '';
                    }
                });
                events.emit('success', trans('entities.attachments_file_updated'));
            };

            /**
             * Delete a file from the server and, on success, the local listing.
             * @param file
             */
            $scope.deleteFile = function(file) {
                if (!file.deleting) {
                    file.deleting = true;
                    return;
                }
                  $http.delete(window.baseUrl(`/attachments/${file.id}`)).then(resp => {
                      events.emit('success', resp.data.message);
                      $scope.files.splice($scope.files.indexOf(file), 1);
                  }, checkError('delete'));
            };

            /**
             * Attach a link to a page.
             * @param file
             */
            $scope.attachLinkSubmit = function(file) {
                file.uploaded_to = pageId;
                $http.post(window.baseUrl('/attachments/link'), file).then(resp => {
                    $scope.files.push(resp.data);
                    events.emit('success', trans('entities.attachments_link_attached'));
                    $scope.file = getCleanFile();
                }, checkError('link'));
            };

            /**
             * Start the edit mode for a file.
             * @param file
             */
            $scope.startEdit = function(file) {
                $scope.editFile = angular.copy(file);
                $scope.editFile.link = (file.external) ? file.path : '';
            };

            /**
             * Cancel edit mode
             */
            $scope.cancelEdit = function() {
                $scope.editFile = false;
            };

            /**
             * Update the name and link of a file.
             * @param file
             */
            $scope.updateFile = function(file) {
                $http.put(window.baseUrl(`/attachments/${file.id}`), file).then(resp => {
                    let search = filesIndexOf(resp.data);
                    if (search !== -1) $scope.files[search] = resp.data;

                    if ($scope.editFile && !file.external) {
                        $scope.editFile.link = '';
                    }
                    $scope.editFile = false;
                    events.emit('success', trans('entities.attachments_updated_success'));
                }, checkError('edit'));
            };

            /**
             * Get the url of a file.
             */
            $scope.getFileUrl = function(file) {
                return window.baseUrl('/attachments/' + file.id);
            };

            /**
             * Search the local files via another file object.
             * Used to search via object copies.
             * @param file
             * @returns int
             */
            function filesIndexOf(file) {
                for (let i = 0; i < $scope.files.length; i++) {
                    if ($scope.files[i].id == file.id) return i;
                }
                return -1;
            }

            /**
             * Check for an error response in a ajax request.
             * @param errorGroupName
             */
            function checkError(errorGroupName) {
                $scope.errors[errorGroupName] = {};
                return function(response) {
                    if (typeof response.data !== 'undefined' && typeof response.data.error !== 'undefined') {
                        events.emit('error', response.data.error);
                    }
                    if (typeof response.data !== 'undefined' && typeof response.data.validation !== 'undefined') {
                        $scope.errors[errorGroupName] = response.data.validation;
                        console.log($scope.errors[errorGroupName])
                    }
                }
            }

        }]);

    // Controller used to reply to and add new comments
    ngApp.controller('CommentReplyController', ['$scope', '$http', '$timeout', function ($scope, $http, $timeout) {
        const MarkdownIt = require("markdown-it");
        const md = new MarkdownIt({html: true});
        let vm = this;

        vm.saveComment = function () {
            let pageId = $scope.comment.pageId || $scope.pageId;
            let comment = $scope.comment.text;
            if (!comment) {
                return events.emit('warning', trans('errors.empty_comment'));
            }
            let commentHTML = md.render($scope.comment.text);
            let serviceUrl = `/ajax/page/${pageId}/comment/`;
            let httpMethod = 'post';
            let reqObj = {
                text: comment,
                html: commentHTML
            };

            if ($scope.isEdit === true) {
                // this will be set when editing the comment.
                serviceUrl = `/ajax/page/${pageId}/comment/${$scope.comment.id}`;
                httpMethod = 'put';
            } else if ($scope.isReply === true) {
                // if its reply, get the parent comment id
                reqObj.parent_id = $scope.parentId;
            }
            $http[httpMethod](window.baseUrl(serviceUrl), reqObj).then(resp => {
                if (!isCommentOpSuccess(resp)) {
                     return;
                }
                // hide the comments first, and then retrigger the refresh
                if ($scope.isEdit) {
                    updateComment($scope.comment, resp.data);
                    $scope.$emit('evt.comment-success', $scope.comment.id);
                } else {
                    $scope.comment.text = '';
                    if ($scope.isReply === true && $scope.parent.sub_comments) {
                        $scope.parent.sub_comments.push(resp.data.comment);
                    } else {
                        $scope.$emit('evt.new-comment', resp.data.comment);
                    }
                    $scope.$emit('evt.comment-success', null, true);
                }
                $scope.comment.is_hidden = true;
                $timeout(function() {
                    $scope.comment.is_hidden = false;
                });

                events.emit('success', trans(resp.data.message));

            }, checkError);

        };

        function checkError(response) {
            let msg = null;
            if (isCommentOpSuccess(response)) {
                // all good
                return;
            } else if (response.data) {
                msg = response.data.message;
            } else {
                msg = trans('errors.comment_add');
            }
            if (msg) {
                events.emit('success', msg);
            }
        }
    }]);

    // Controller used to delete comments
    ngApp.controller('CommentDeleteController', ['$scope', '$http', '$timeout', function ($scope, $http, $timeout) {
        let vm = this;

        vm.delete = function(comment) {
            $http.delete(window.baseUrl(`/ajax/comment/${comment.id}`)).then(resp => {
                if (!isCommentOpSuccess(resp)) {
                    return;
                }
                updateComment(comment, resp.data, $timeout, true);
            }, function (resp) {
                if (isCommentOpSuccess(resp)) {
                    events.emit('success', trans('entities.comment_deleted'));
                } else {
                    events.emit('error', trans('error.comment_delete'));
                }
            });
        };
    }]);

    // Controller used to fetch all comments for a page
    ngApp.controller('CommentListController', ['$scope', '$http', '$timeout', '$location', function ($scope, $http, $timeout, $location) {
        let vm = this;
        $scope.errors = {};
        // keep track of comment levels
        $scope.level = 1;
        vm.totalCommentsStr = trans('entities.comments_loading');
        vm.permissions = {};
        vm.trans = window.trans;

        $scope.$on('evt.new-comment', function (event, comment) {
            // add the comment to the comment list.
            vm.comments.push(comment);
            ++vm.totalComments;
            setTotalCommentMsg();
            event.stopPropagation();
            event.preventDefault();
        });

        vm.canEditDelete = function (comment, prop) {
            if (!comment.active) {
                return false;
            }
            let propAll = prop + '_all';
            let propOwn = prop + '_own';

            if (vm.permissions[propAll]) {
                return true;
            }

            if (vm.permissions[propOwn] && comment.created_by.id === vm.current_user_id) {
                return true;
            }

            return false;
        };

        vm.canComment = function () {
            return vm.permissions.comment_create;
        };

        // check if there are is any direct linking
        let linkedCommentId = $location.search().cm;

        $timeout(function() {
            $http.get(window.baseUrl(`/ajax/page/${$scope.pageId}/comments/`)).then(resp => {
                if (!isCommentOpSuccess(resp)) {
                    // just show that no comments are available.
                    vm.totalComments = 0;
                    setTotalCommentMsg();
                    return;
                }
                vm.comments = resp.data.comments;
                vm.totalComments = +resp.data.total;
                vm.permissions = resp.data.permissions;
                vm.current_user_id = resp.data.user_id;
                setTotalCommentMsg();
                if (!linkedCommentId) {
                    return;
                }
                $timeout(function() {
                    // wait for the UI to render.
                    focusLinkedComment(linkedCommentId);
                });
            }, checkError);
        });

        function setTotalCommentMsg () {
            if (vm.totalComments === 0) {
                vm.totalCommentsStr = trans('entities.no_comments');
            } else if (vm.totalComments === 1) {
                vm.totalCommentsStr = trans('entities.one_comment');
            } else {
                vm.totalCommentsStr = trans('entities.x_comments', {
                    numComments: vm.totalComments
                });
            }
        }

        function focusLinkedComment(linkedCommentId) {
            let comment = angular.element('#' + linkedCommentId);
            if (comment.length === 0) {
                return;
            }

            window.setupPageShow.goToText(linkedCommentId);
        }

        function checkError(response) {
            let msg = null;
            if (isCommentOpSuccess(response)) {
                // all good
                return;
            } else if (response.data) {
                msg = response.data.message;
            } else {
                msg = trans('errors.comment_list');
            }
            if (msg) {
                events.emit('success', msg);
            }
        }
    }]);

    function updateComment(comment, resp, $timeout, isDelete) {
        comment.text = resp.comment.text;
        comment.updated = resp.comment.updated;
        comment.updated_by = resp.comment.updated_by;
        comment.active = resp.comment.active;
        if (isDelete && !resp.comment.active) {
            comment.html = trans('entities.comment_deleted');
        } else {
            comment.html = resp.comment.html;
        }
        if (!$timeout) {
            return;
        }
        comment.is_hidden = true;
        $timeout(function() {
            comment.is_hidden = false;
        });
    }

    function isCommentOpSuccess(resp) {
        if (resp && resp.data && resp.data.status === 'success') {
            return true;
        }
        return false;
    }
};
