curl -s -X POST http://localhost:3000/documents/upload/parse \
  -F 'file=@./test-files/02-production-release-sop.pdf' \
  -F 'authorId=10001' \
  -F 'createBy=10001' \
  -F 'tags=导入,xlsx' | jq




  curl -s -X PUT "http://localhost:3000/documents/349619129113645056/publish"